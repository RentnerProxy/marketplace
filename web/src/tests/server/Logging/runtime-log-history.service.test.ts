import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import { RUNTIME_LOGS } from '@/config/logging.config.ts'
import type { RuntimeLogEntry } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import type { AppValkeyClient } from '@/server/Valkey/Types/valkey-client.types.ts'
import { mockValkeyDefineCommand } from '@/tests/shared/valkey-script.test.helpers.ts'
import {
    attachRuntimeLogConnectionService,
    getRuntimeLogSnapshotService,
    recordRuntimeLogService,
    setRuntimeLogProcessService,
} from '@/server/Logging/runtime-log-history.service.ts'

function createClient() {
    const evalScript = vi.fn(
        async (
            script: string,
            _keyCount: number,
            ..._arguments: Array<string | number>
        ): Promise<unknown> => (script.includes('LRANGE') ? [] : 1),
    )
    return {
        status: 'wait',
        get: async () => null,
        set: async () => 'OK' as const,
        del: async () => 0,
        eval: evalScript,
        defineCommand: mockValkeyDefineCommand(evalScript),
        ping: async () => 'PONG',
        publish: async () => 0,
        subscribe: async () => 0,
        on() {
            return this
        },
        off() {
            return this
        },
        quit: async () => 'OK',
        disconnect() {},
    } satisfies AppValkeyClient
}

let client = createClient()
let clock = Date.now()

function entry(event: string): RuntimeLogEntry {
    return {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        event,
        level: 'info',
        context: {},
    }
}

beforeEach(function () {
    clock += RUNTIME_LOGS.retentionMs * 2
    setSystemTime(new Date(clock))
    client = createClient()
    setRuntimeLogProcessService('webserver')
})

afterEach(function () {
    client.status = 'wait'
    setSystemTime()
})

describe('Begrenzter, bereinigter Laufzeit-Logverlauf', function () {
    it('ordnet Realtime-Ereignisse und explizite WebSocket-Statusmeldungen dem eigenen Verlauf zu', async () => {
        recordRuntimeLogService({
            event: 'realtime.server_started',
            level: 'info',
            context: { port: 3001 },
        })
        recordRuntimeLogService({
            event: 'health.websocket_responding',
            level: 'info',
            context: { service: 'websocket' },
        })
        const snapshot = await getRuntimeLogSnapshotService('websocket', client)
        expect(snapshot.entries.map((logEntry) => logEntry.event)).toEqual([
            'realtime.server_started',
            'health.websocket_responding',
        ])
        const unrelated = await getRuntimeLogSnapshotService(
            'postgresql',
            client,
        )
        expect(
            unrelated.entries.some(
                (logEntry) => logEntry.event === 'realtime.server_started',
            ),
        ).toBe(false)
    })
    it('trennt Webserver-, Worker-, Datenbank- und Valkey-Ereignisse', async function () {
        recordRuntimeLogService({
            level: 'info',
            event: 'app.started',
            context: {},
        })
        setRuntimeLogProcessService('worker')
        recordRuntimeLogService({
            level: 'info',
            event: 'queue.worker.started',
            context: {},
        })
        recordRuntimeLogService({
            level: 'warn',
            event: 'db.failed',
            context: {},
        })
        recordRuntimeLogService({
            level: 'warn',
            event: 'valkey.connection_unavailable',
            context: {},
        })
        recordRuntimeLogService({
            level: 'warn',
            event: 'admin.dashboard.health_check_failed',
            context: { service: 'postgresql' },
        })
        const web = await getRuntimeLogSnapshotService('webserver', client)
        const worker = await getRuntimeLogSnapshotService('worker', client)
        const database = await getRuntimeLogSnapshotService(
            'postgresql',
            client,
        )
        const valkey = await getRuntimeLogSnapshotService('valkey', client)
        expect(web.entries.map((log) => log.event)).toEqual(['app.started'])
        expect(worker.entries.map((log) => log.event)).toEqual([
            'queue.worker.started',
        ])
        expect(database.entries.map((log) => log.event)).toEqual([
            'db.failed',
            'admin.dashboard.health_check_failed',
        ])
        expect(valkey.entries.map((log) => log.event)).toEqual([
            'valkey.connection_unavailable',
        ])
    })

    it('verwirft private Inhalte vor der Speicherung und erhält sichere Fehlercodes', async function () {
        recordRuntimeLogService({
            level: 'error',
            event: 'app.failed',
            context: {
                durationMs: 12,
                errorName: 'TypeError',
                errorCode: 'ECONNREFUSED',
                password: 'synthetic-secret',
                databaseUrl: 'postgresql://synthetic-secret@invalid.test/app',
                query: 'select synthetic-secret',
                email: 'synthetic-secret@invalid.test',
                stack: 'synthetic-secret',
            },
        })
        const result = await getRuntimeLogSnapshotService('webserver', client)
        expect(result.entries[0]?.context).toEqual({
            durationMs: 12,
            errorName: 'TypeError',
            errorCode: 'ECONNREFUSED',
        })
        expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    })

    it('vereinigt den gemeinsamen Verlauf ohne Duplikate und validiert fremde Einträge erneut', async function () {
        const older = entry('app.started')
        const newer = {
            ...entry('app.ready'),
            context: { durationMs: 5, password: 'synthetic-secret' },
        }
        client.eval.mockResolvedValueOnce([
            JSON.stringify(newer),
            '{invalid',
            JSON.stringify({ ...older, event: 'private@invalid.test' }),
            JSON.stringify(older),
            JSON.stringify(older),
        ])
        const result = await getRuntimeLogSnapshotService('webserver', client)
        expect(result.sharedHistoryAvailable).toBe(true)
        expect(result.entries.map((log) => log.id)).toEqual([
            older.id,
            newer.id,
        ])
        expect(result.entries[1]?.context).toEqual({ durationMs: 5 })
        expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    })

    it('keeps returned snapshots independent from the pending and local buffers', async function () {
        const context = { count: 1 }
        recordRuntimeLogService({
            level: 'info',
            event: 'app.request',
            context,
        })
        context.count = 2

        const first = await getRuntimeLogSnapshotService('webserver', client)
        expect(first.entries[0]?.context.count).toBe(1)
        const returnedEntry = first.entries[0]
        if (!returnedEntry) throw new Error('Expected a recorded runtime log')
        returnedEntry.context.count = 3
        returnedEntry.event = 'app.modified'

        const second = await getRuntimeLogSnapshotService('webserver', client)
        expect(second.entries[0]?.context.count).toBe(1)
        expect(second.entries[0]?.event).toBe('app.request')
    })

    it('behält bei ausgefallenem gemeinsamem Verlauf ausschließlich lokale Ereignisse lesbar', async function () {
        recordRuntimeLogService(
            { level: 'info', event: 'health.responding', context: {} },
            'webserver',
        )
        client.eval.mockRejectedValueOnce(new Error('synthetic-secret'))
        const result = await getRuntimeLogSnapshotService('webserver', client)
        expect(result.sharedHistoryAvailable).toBe(false)
        expect(result.entries.map((log) => log.event)).toEqual([
            'health.responding',
        ])
        expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    })

    it('entfernt Ereignisse nach Ablauf der Aufbewahrungszeit', async function () {
        const expired = {
            ...entry('app.started'),
            timestamp: new Date(
                clock - RUNTIME_LOGS.retentionMs - 1,
            ).toISOString(),
        }
        client.eval.mockResolvedValueOnce([JSON.stringify(expired)])
        expect(
            (await getRuntimeLogSnapshotService('webserver', client)).entries,
        ).toEqual([])
    })

    it('begrenzt lokalen Puffer und gebündelte Übertragung auch bei vielen Ereignissen', async function () {
        for (let index = 0; index < RUNTIME_LOGS.maxEntries + 10; index++) {
            recordRuntimeLogService(
                {
                    level: 'info',
                    event: 'app.request',
                    context: { count: index },
                },
                'webserver',
            )
        }
        const result = await getRuntimeLogSnapshotService('webserver', client)
        expect(result.entries).toHaveLength(RUNTIME_LOGS.maxEntries)
        expect(result.entries[0]?.context.count).toBe(10)
        expect(result.entries.at(-1)?.context.count).toBe(309)
        client.eval.mockClear()
        client.status = 'ready'
        attachRuntimeLogConnectionService(client)
        expect(client.eval).not.toHaveBeenCalled()
        await new Promise((resolve) =>
            setTimeout(resolve, RUNTIME_LOGS.flushIntervalMs + 30),
        )
        const batch = client.eval.mock.calls.find(
            (call) => call[2] === RUNTIME_LOGS.keyPrefix + 'webserver',
        )
        expect(batch?.slice(3, 5)).toEqual([
            RUNTIME_LOGS.maxEntries,
            RUNTIME_LOGS.retentionMs,
        ])
        expect(batch?.slice(5)).toHaveLength(RUNTIME_LOGS.maxEntries)
        expect(batch?.[0]).toContain('LTRIM')
        expect(batch?.[0]).toContain('PEXPIRE')
    })
})
