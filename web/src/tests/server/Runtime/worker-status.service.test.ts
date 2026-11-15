import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { WORKER_HEALTH } from '@/config/health.config.ts'
import type { WorkerRuntimeStatus } from '@/server/Runtime/Types/worker-status.types.ts'

const instanceId = '11111111-1111-4111-8111-111111111111'
const now = 100_000
const values = new Map<string, string>()
const get = vi.fn(async (key: string) => values.get(key) ?? null)
const set = vi.fn(async function (
    key: string,
    content: string,
    _mode: string,
    _ttl: number,
) {
    values.set(key, content)
    return 'OK'
})
const evaluate = vi.fn(async function (
    _script: string,
    _count: number,
    key: string,
    content: string,
) {
    if (values.get(key) !== content) return 0
    values.delete(key)
    return 1
})
const warn = vi.fn()

vi.mock('@/server/Valkey/valkey.service.ts', () => ({
    getValkeyConnection: () => ({ get, set, eval: evaluate }),
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logWarn: warn }))

const { createWorkerStatusReporterService, getWorkerRuntimeHealthService } =
    await import('@/server/Runtime/worker-status.service.ts')

function storeHeartbeat(status: WorkerRuntimeStatus, updatedAt = now) {
    values.set(
        WORKER_HEALTH.statusKey,
        JSON.stringify({ version: 1, instanceId, status, updatedAt }),
    )
}

beforeEach(function () {
    vi.clearAllMocks()
    values.clear()
    vi.spyOn(Date, 'now').mockReturnValue(now)
})
afterEach(function () {
    vi.restoreAllMocks()
})

describe('Worker-Status über die gemeinsame Valkey-Verbindung', function () {
    it.each(['starting', 'running', 'error'] as const)(
        'liest einen frischen %s-Heartbeat über Prozessgrenzen hinweg',
        async function (status) {
            storeHeartbeat(status)
            expect(await getWorkerRuntimeHealthService()).toEqual({
                status,
                reason: 'heartbeat',
            })
            expect(get).toHaveBeenCalledWith(WORKER_HEALTH.statusKey)
        },
    )

    it('wertet einen fehlenden Heartbeat als down', async function () {
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'down',
            reason: 'missing',
        })
    })

    it.each([now - WORKER_HEALTH.maxAgeMs - 1, now + 1])(
        'akzeptiert keinen veralteten oder zukünftigen Heartbeat (%s)',
        async function (updatedAt) {
            storeHeartbeat('running', updatedAt)
            expect(await getWorkerRuntimeHealthService()).toEqual({
                status: 'down',
                reason: 'expired',
            })
        },
    )

    it.each([
        '{invalid',
        JSON.stringify({
            version: 2,
            instanceId,
            status: 'running',
            updatedAt: now,
        }),
        JSON.stringify({
            version: 1,
            instanceId,
            status: 'unknown',
            updatedAt: now,
        }),
        JSON.stringify({ version: 1, status: 'running', updatedAt: now }),
    ])('lehnt ungültige Statusdaten ab', async function (content) {
        values.set(WORKER_HEALTH.statusKey, content)
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'error',
            reason: 'invalid',
        })
    })

    it('veröffentlicht Status mit Ablaufzeit und erholt sich nach Valkey-Verlust', async function () {
        const reporter = createWorkerStatusReporterService()
        await reporter.reportStatus('starting')
        expect(set).toHaveBeenCalledWith(
            WORKER_HEALTH.statusKey,
            expect.any(String),
            'PX',
            WORKER_HEALTH.maxAgeMs,
        )
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'starting',
            reason: 'heartbeat',
        })
        values.clear()
        await reporter.reportStatus('running')
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'running',
            reason: 'heartbeat',
        })
    })

    it('entfernt beim Beenden nur den eigenen zuletzt veröffentlichten Status', async function () {
        const oldReporter = createWorkerStatusReporterService()
        const newReporter = createWorkerStatusReporterService()
        await oldReporter.reportStatus('running')
        await newReporter.reportStatus('starting')
        await oldReporter.stop()
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'starting',
            reason: 'heartbeat',
        })
        await newReporter.stop()
        expect(await getWorkerRuntimeHealthService()).toEqual({
            status: 'down',
            reason: 'missing',
        })
        expect(evaluate.mock.calls[0]?.[0]).toContain(
            "server.call('GET', KEYS[1]) == ARGV[1]",
        )
    })

    it('lässt den Worker bei einem Status-Publish-Fehler weiterlaufen und loggt keine Ursache', async function () {
        set.mockRejectedValueOnce(new Error('private-connection-password'))
        const reporter = createWorkerStatusReporterService()
        await expect(reporter.reportStatus('running')).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledWith(
            'background_worker.status_publish_failed',
        )
        await reporter.stop()
        expect(evaluate).not.toHaveBeenCalled()
        await reporter.reportStatus('running')
        evaluate.mockRejectedValueOnce(new Error('private-connection-password'))
        await expect(reporter.stop()).resolves.toBeUndefined()
        expect(warn).toHaveBeenLastCalledWith(
            'background_worker.status_cleanup_failed',
        )
    })
})
