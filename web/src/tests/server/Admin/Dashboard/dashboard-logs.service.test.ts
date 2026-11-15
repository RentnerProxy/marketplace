import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RUNTIME_LOGS } from '@/config/logging.config.ts'
import type {
    RuntimeLogEntry,
    RuntimeLogSnapshot,
} from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'

const readerOrigin = vi.fn((): string | null => 'http://127.0.0.1:3004')
const containerLogs = vi.fn(
    async (_origin: string, _service: string): Promise<RuntimeLogSnapshot> => ({
        source: 'container',
        entries: [],
        sharedHistoryAvailable: true,
    }),
)
const runtimeLogs = vi.fn(
    async (
        _service: string,
        _client: unknown,
    ): Promise<RuntimeLogSnapshot> => ({
        source: 'application',
        entries: [],
        sharedHistoryAvailable: true,
    }),
)
const connection = {}

vi.mock('@/server/Logging/container-log-client.service.ts', () => ({
    getContainerLogReaderOriginService: readerOrigin,
    getContainerLogsService: containerLogs,
}))
vi.mock('@/server/Logging/runtime-log-history.service.ts', () => ({
    getRuntimeLogSnapshotService: runtimeLogs,
}))
vi.mock('@/server/Valkey/valkey.service.ts', () => ({
    getValkeyConnection: () => connection,
}))
vi.mock('@/server/Core/health.service.ts', () => ({
    getCoreRuntimeOriginService: () => 'http://localhost:3004',
}))

const { getDashboardLogsService } =
    await import('@/server/Admin/Dashboard/dashboard-logs.service.ts')

function entry(event: string, timestamp = '2026-11-13T10:00:00.000Z') {
    return {
        id: crypto.randomUUID(),
        timestamp,
        level: 'info',
        event,
        context: {},
    } satisfies RuntimeLogEntry
}

beforeEach(function () {
    vi.clearAllMocks()
    containerLogs.mockReset()
    runtimeLogs.mockReset()
    readerOrigin.mockReturnValue('http://127.0.0.1:3004')
    containerLogs.mockResolvedValue({
        source: 'container',
        entries: [],
        sharedHistoryAvailable: true,
    })
    runtimeLogs.mockResolvedValue({
        source: 'application',
        entries: [],
        sharedHistoryAvailable: true,
    })
})

describe('Dienstlogs mit bestätigten Statusprüfungen', function () {
    it.each([
        'webserver',
        'worker',
        'postgresql',
        'valkey',
        'websocket',
        'core',
    ] as const)(
        'zeigt den geprüften Status auch bei stiller Container-Ausgabe (%s)',
        async function (service) {
            const health = entry('health.connection_available')
            runtimeLogs.mockResolvedValueOnce({
                source: 'application',
                entries: [health],
                sharedHistoryAvailable: true,
            })

            expect(await getDashboardLogsService(service)).toEqual({
                source: 'container',
                entries: [health],
                sharedHistoryAvailable: true,
            })
            expect(runtimeLogs).toHaveBeenCalledWith(service, connection)
            expect(containerLogs).toHaveBeenCalledWith(
                service === 'core'
                    ? 'http://localhost:3004'
                    : 'http://127.0.0.1:3004',
                service,
            )
        },
    )

    it('vereinigt Statusprüfungen und Containerlogs chronologisch ohne doppelte Anwendungsereignisse', async function () {
        const output = {
            ...entry('container.stdout', '2026-11-13T10:00:01Z'),
            message: 'Originale Container-Ausgabe',
        }
        const older = entry('health.connection_available')
        const newer = entry(
            'health.connection_closed',
            '2026-11-13T10:00:01.500Z',
        )
        containerLogs.mockResolvedValueOnce({
            source: 'container',
            entries: [output],
            sharedHistoryAvailable: true,
        })
        runtimeLogs.mockResolvedValueOnce({
            source: 'application',
            entries: [older, entry('valkey.connection_unavailable'), newer],
            sharedHistoryAvailable: true,
        })

        expect((await getDashboardLogsService('valkey')).entries).toEqual([
            older,
            output,
            newer,
        ])
    })

    it('hält den kombinierten Verlauf auf höchstens 300 aktuellen Einträgen', async function () {
        const output = Array.from({ length: RUNTIME_LOGS.maxEntries }, () =>
            entry('container.stdout'),
        )
        const health = entry('health.responding', '2026-11-13T10:00:01.000Z')
        containerLogs.mockResolvedValueOnce({
            source: 'container',
            entries: output,
            sharedHistoryAvailable: true,
        })
        runtimeLogs.mockResolvedValueOnce({
            source: 'application',
            entries: [health],
            sharedHistoryAvailable: true,
        })

        const snapshot = await getDashboardLogsService('webserver')
        expect(snapshot.entries).toHaveLength(RUNTIME_LOGS.maxEntries)
        expect(snapshot.entries.at(-1)).toEqual(health)
        expect(snapshot.entries).not.toContainEqual(output[0])
    })

    it('kennzeichnet fehlenden gemeinsamen Verlauf und erhält Containerlogs und lokale Prüfungen', async function () {
        const health = entry('health.connection_available')
        runtimeLogs.mockResolvedValueOnce({
            source: 'application',
            entries: [health],
            sharedHistoryAvailable: false,
        })

        expect(await getDashboardLogsService('postgresql')).toEqual({
            source: 'container',
            entries: [health],
            sharedHistoryAvailable: false,
        })
    })

    it('liest ohne Container-Anbindung den bisherigen Anwendungsverlauf', async function () {
        readerOrigin.mockReturnValue(null)
        const application: RuntimeLogSnapshot = {
            source: 'application',
            entries: [entry('valkey.connection_restored')],
            sharedHistoryAvailable: true,
        }
        runtimeLogs.mockResolvedValueOnce(application)

        expect(await getDashboardLogsService('valkey')).toEqual(application)
        expect(containerLogs).not.toHaveBeenCalled()
    })

    it('liest die Core-Ausgabe auch im Entwicklungsbetrieb aus dem echten Rust-Prozess', async function () {
        readerOrigin.mockReturnValue(null)
        await getDashboardLogsService('core')
        expect(containerLogs).toHaveBeenCalledWith(
            'http://localhost:3004',
            'core',
        )
    })

    it('verdeckt einen ausgefallenen Container-Logleser nicht mit erfolgreichen Statusmeldungen', async function () {
        containerLogs.mockRejectedValueOnce(
            new Error('container_logs_unavailable'),
        )
        runtimeLogs.mockResolvedValueOnce({
            source: 'application',
            entries: [entry('health.responding')],
            sharedHistoryAvailable: true,
        })

        await expect(getDashboardLogsService('webserver')).rejects.toThrow(
            'container_logs_unavailable',
        )
    })
})
