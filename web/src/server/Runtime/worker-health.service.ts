import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { WORKER_HEALTH } from '@/config/health.config.ts'

const workerHeartbeatSchema = z
    .object({
        version: z.literal(1),
        status: z.enum(['healthy', 'unhealthy']),
        updatedAt: z.number().int().nonnegative(),
        pid: z.number().int().positive(),
    })
    .strict()

function getWorkerHeartbeatPath() {
    return path.join(tmpdir(), 'rentnerproxy-marketplace-worker-heartbeat.json')
}

async function writeWorkerHeartbeat(
    heartbeatPath: string,
    status: 'healthy' | 'unhealthy',
    now: number,
) {
    const temporaryPath = `${heartbeatPath}.${process.pid}.${crypto.randomUUID()}.tmp`
    const content = JSON.stringify({
        version: 1,
        status,
        updatedAt: now,
        pid: process.pid,
    })

    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, heartbeatPath)
}

export async function assertWorkerHeartbeatHealthyService(options?: {
    heartbeatPath?: string
    maxAgeMs?: number
    now?: number
}) {
    const heartbeatPath = options?.heartbeatPath ?? getWorkerHeartbeatPath()
    const maxAgeMs = options?.maxAgeMs ?? WORKER_HEALTH.maxAgeMs
    const now = options?.now ?? Date.now()
    const content = await readFile(heartbeatPath, 'utf8')
    const heartbeat = workerHeartbeatSchema.parse(JSON.parse(content))

    if (heartbeat.status !== 'healthy') {
        throw new Error('Der Background-Worker meldet keinen gesunden Zustand.')
    }

    const age = now - heartbeat.updatedAt

    if (age < 0 || age > maxAgeMs) {
        throw new Error('Der Background-Worker-Heartbeat ist veraltet.')
    }

    return heartbeat
}

export async function isBackgroundWorkerRuntimeHealthyService(options: {
    isMailWorkerRunning: () => boolean
    isBackupWorkerRunning: (() => boolean) | null
    isRestoreQuiescenceHealthyPaused: () => boolean | Promise<boolean>
    isStorageMutationBarrierHealthy: () => boolean
    pingValkey: () => Promise<string>
}) {
    if (
        !options.isMailWorkerRunning() ||
        !options.isStorageMutationBarrierHealthy()
    ) {
        return false
    }

    const backupWorkerReady = options.isBackupWorkerRunning
        ? options.isBackupWorkerRunning()
        : await options.isRestoreQuiescenceHealthyPaused()

    if (!backupWorkerReady) {
        return false
    }

    try {
        return (await options.pingValkey()) === 'PONG'
    } catch {
        return false
    }
}

export async function startWorkerHeartbeatService(options: {
    isHealthy: () => boolean | Promise<boolean>
    heartbeatPath?: string
    intervalMs?: number
    now?: () => number
    onError?: (error: unknown) => void
    onHeartbeat?: (isHealthy: boolean) => void | Promise<void>
    signal?: AbortSignal
}) {
    const heartbeatPath = options.heartbeatPath ?? getWorkerHeartbeatPath()
    const intervalMs = options.intervalMs ?? WORKER_HEALTH.intervalMs
    const now = options.now ?? Date.now
    let stopped = false
    let pendingUpdate: Promise<void> | undefined

    async function updateHeartbeat() {
        if (stopped || options.signal?.aborted) return
        const isHealthy = await options.isHealthy()
        if (stopped || options.signal?.aborted) return
        await writeWorkerHeartbeat(
            heartbeatPath,
            isHealthy ? 'healthy' : 'unhealthy',
            now(),
        )
        if (stopped || options.signal?.aborted) {
            await rm(heartbeatPath, { force: true })
            return
        }
        await options.onHeartbeat?.(isHealthy)
    }

    function scheduleUpdate() {
        if (stopped || options.signal?.aborted || pendingUpdate) return
        pendingUpdate = updateHeartbeat()
            .catch(function (error) {
                options.onError?.(error)
            })
            .finally(function () {
                pendingUpdate = undefined
            })
    }

    await updateHeartbeat()

    const interval = options.signal?.aborted
        ? undefined
        : setInterval(scheduleUpdate, intervalMs)
    interval?.unref()

    return {
        stop: async function () {
            stopped = true
            clearInterval(interval)
            await pendingUpdate
            await rm(heartbeatPath, { force: true })
        },
    }
}
