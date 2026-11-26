import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    isBackgroundWorkerRuntimeHealthyService,
    startWorkerHeartbeatService,
} from '@/server/Runtime/worker-health.service.ts'

let testRoot = ''
let heartbeatPath = ''

beforeEach(async function () {
    testRoot = await mkdtemp(path.join(tmpdir(), 'worker-health-test-'))
    heartbeatPath = path.join(testRoot, 'heartbeat.json')
})

afterEach(async function () {
    vi.useRealTimers()
    await rm(testRoot, { recursive: true, force: true })
})

describe('Worker-Heartbeat', function () {
    it('lässt bei einer langsamen Prüfung keine überlappenden oder aufgestauten Healthchecks zu', async function () {
        vi.useFakeTimers()
        const pendingProbe = Promise.withResolvers<boolean>()
        const secondReport = Promise.withResolvers<void>()
        const isHealthy = vi.fn(() => true as boolean | Promise<boolean>)
        const reported = vi.fn()
        const heartbeat = await startWorkerHeartbeatService({
            heartbeatPath,
            intervalMs: 100,
            isHealthy,
            onHeartbeat: function () {
                reported()
                if (reported.mock.calls.length === 2) secondReport.resolve()
            },
        })
        isHealthy.mockReturnValueOnce(pendingProbe.promise)
        try {
            vi.advanceTimersByTime(500)
            expect(isHealthy).toHaveBeenCalledTimes(2)
            expect(reported).toHaveBeenCalledTimes(1)
            pendingProbe.resolve(true)
            await secondReport.promise
            expect(reported).toHaveBeenCalledTimes(2)
            expect(isHealthy).toHaveBeenCalledTimes(2)
        } finally {
            pendingProbe.resolve(true)
            await heartbeat.stop()
        }
        expect(vi.getTimerCount()).toBe(0)
    })

    it('verwirft ein verspätetes Prüfergebnis beim Stoppen und veröffentlicht keinen neuen Running-Status', async function () {
        vi.useFakeTimers()
        const pendingProbe = Promise.withResolvers<boolean>()
        const isHealthy = vi.fn(() => true as boolean | Promise<boolean>)
        const reported = vi.fn()
        const heartbeat = await startWorkerHeartbeatService({
            heartbeatPath,
            intervalMs: 100,
            isHealthy,
            onHeartbeat: reported,
        })
        isHealthy.mockReturnValueOnce(pendingProbe.promise)
        vi.advanceTimersByTime(100)
        const stopping = heartbeat.stop()
        pendingProbe.resolve(true)
        await stopping
        expect(reported).toHaveBeenCalledTimes(1)
        expect(await Bun.file(heartbeatPath).exists()).toBe(false)
        vi.advanceTimersByTime(1_000)
        expect(isHealthy).toHaveBeenCalledTimes(2)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('erzeugt nach einem Abbruch während der ersten Prüfung weder Heartbeat-Datei noch Intervall', async function () {
        vi.useFakeTimers()
        const pendingProbe = Promise.withResolvers<boolean>()
        const controller = new AbortController()
        const reported = vi.fn()
        const starting = startWorkerHeartbeatService({
            heartbeatPath,
            signal: controller.signal,
            isHealthy: () => pendingProbe.promise,
            onHeartbeat: reported,
        })
        controller.abort()
        pendingProbe.resolve(true)
        const heartbeat = await starting
        expect(reported).not.toHaveBeenCalled()
        expect(await Bun.file(heartbeatPath).exists()).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        await heartbeat.stop()
    })

    it('wertet einen absichtlich pausierten Backup-Worker während eines Restores als gesund', async function () {
        await expect(
            isBackgroundWorkerRuntimeHealthyService({
                isMailWorkerRunning: () => true,
                isBackupWorkerRunning: null,
                isRestoreQuiescenceHealthyPaused: async () => true,
                isStorageMutationBarrierHealthy: () => true,
                pingValkey: async () => 'PONG',
            }),
        ).resolves.toBe(true)
    })

    it('wertet fehlenden Backup-Worker ohne bestätigte Restore-Pause als ungesund', async function () {
        await expect(
            isBackgroundWorkerRuntimeHealthyService({
                isMailWorkerRunning: () => true,
                isBackupWorkerRunning: null,
                isRestoreQuiescenceHealthyPaused: async () => false,
                isStorageMutationBarrierHealthy: () => true,
                pingValkey: async () => 'PONG',
            }),
        ).resolves.toBe(false)
    })

    it('wertet einen unbestätigt freigegebenen Storage-Lock als ungesund', async function () {
        await expect(
            isBackgroundWorkerRuntimeHealthyService({
                isMailWorkerRunning: () => true,
                isBackupWorkerRunning: () => true,
                isRestoreQuiescenceHealthyPaused: async () => false,
                isStorageMutationBarrierHealthy: () => false,
                pingValkey: async () => 'PONG',
            }),
        ).resolves.toBe(false)
    })

    it.each([
        [true, 'healthy'],
        [false, 'unhealthy'],
    ])('writes and reports probe result %s', async function (healthy, status) {
        const onHeartbeat = vi.fn()
        const heartbeat = await startWorkerHeartbeatService({
            heartbeatPath,
            intervalMs: 60_000,
            isHealthy: () => healthy,
            now: () => 1_000,
            onHeartbeat,
        })

        const heartbeatFile = Bun.file(heartbeatPath)
        try {
            expect(await heartbeatFile.json()).toEqual({
                version: 1,
                status,
                updatedAt: 1_000,
                pid: process.pid,
            })
            expect(onHeartbeat).toHaveBeenCalledWith(healthy)
        } finally {
            await heartbeat.stop()
        }
        expect(await heartbeatFile.exists()).toBe(false)
    })
})
