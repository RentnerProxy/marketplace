import { CORE_RUNTIME } from '@/config/core.config.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { CoreCommandError } from './error.ts'
import { CoreWorker } from './worker.service.ts'
import { getCoreBinaryPathService } from './binary.service.ts'
import { validateCoreBinaryInputService } from './binary-payload.service.ts'
import type { CoreBinary, CoreCommandOptions } from './Types/core.types.ts'
import type { CoreWorkerInput } from './Types/worker.types.ts'

type Job = {
    input: CoreWorkerInput
    bytes: number
    options: CoreCommandOptions
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    finished: boolean
    cancellation?: unknown
    timer?: ReturnType<typeof setTimeout>
    abort: () => void
    worker?: CoreWorker
}

type Slot = { worker?: CoreWorker; busy: boolean; task?: Promise<void> }

class CoreWorkerPool {
    private readonly slots = new Set<Slot>()
    private readonly queue: Job[] = []
    private readonly jobs = new Set<Job>()
    private admittedBytes = 0
    private closing = false
    private retiring = false
    private executable?: Promise<string>

    constructor(
        private readonly binary: CoreBinary,
        private readonly onClosed: (pool: CoreWorkerPool) => void,
    ) {}

    admit(input: CoreWorkerInput, bytes: number, options: CoreCommandOptions) {
        if (this.closing)
            throw new CoreCommandError(
                'CORE_UNAVAILABLE',
                'Der Core-Pool wird heruntergefahren.',
            )
        if (
            this.jobs.size >= CORE_RUNTIME.workerMaxQueueSize ||
            bytes > CORE_RUNTIME.workerMaxQueuedBytes - this.admittedBytes
        ) {
            throw new CoreCommandError(
                'CORE_BUSY',
                'Der Core-Pool ist ausgelastet. Bitte später erneut versuchen.',
            )
        }
        // Copy only after checking every bound, synchronously before any suspension.
        const binaryInput =
            input.binaryInput === undefined
                ? undefined
                : Buffer.from(input.binaryInput)
        return new Promise<unknown>((resolve, reject) => {
            const job: Job = {
                input: {
                    payload: input.payload,
                    binaryInput,
                    binaryOutput: input.binaryOutput,
                },
                bytes,
                options,
                resolve,
                reject,
                finished: false,
                abort: () =>
                    this.cancel(
                        job,
                        options.signal?.reason ??
                            new CoreCommandError(
                                'CORE_CANCELLED',
                                'Der Core-Auftrag wurde abgebrochen.',
                            ),
                    ),
            }
            this.jobs.add(job)
            this.admittedBytes += bytes
            this.queue.push(job)
            options.signal?.addEventListener('abort', job.abort, { once: true })
            job.timer = setTimeout(
                () =>
                    this.cancel(
                        job,
                        new CoreCommandError(
                            'CORE_TIMEOUT',
                            'Der Core-Auftrag hat sein Zeitlimit überschritten.',
                        ),
                    ),
                options.timeoutMs ?? CORE_RUNTIME.commandTimeoutMs,
            )
            if (options.signal?.aborted) job.abort()
            this.pump()
        })
    }

    private cancel(job: Job, reason: unknown) {
        if (job.finished || job.cancellation !== undefined) return
        job.cancellation = reason
        if (job.worker) job.worker.cancel(reason)
        else this.settle(job, undefined, reason)
    }

    private settle(job: Job, value?: unknown, error?: unknown) {
        if (job.finished) return
        job.finished = true
        clearTimeout(job.timer)
        job.options.signal?.removeEventListener('abort', job.abort)
        this.jobs.delete(job)
        const queued = this.queue.indexOf(job)
        if (queued !== -1) this.queue.splice(queued, 1)
        this.admittedBytes -= job.bytes
        job.input.binaryInput?.fill(0)
        if (error !== undefined) job.reject(error)
        else job.resolve(value)
        if (this.retiring && this.jobs.size === 0) void this.close()
    }

    private pump() {
        if (this.closing) return
        while (this.queue.length) {
            let slot = [...this.slots].find(
                (candidate) => !candidate.busy && candidate.worker?.usable,
            )
            if (!slot) {
                if (this.slots.size >= CORE_RUNTIME.workerMaxProcesses) return
                slot = { busy: false }
                this.slots.add(slot)
            }
            const job = this.queue.shift()
            if (!job) return
            slot.busy = true
            slot.task = this.run(slot, job)
        }
    }

    private async run(slot: Slot, job: Job) {
        try {
            if (!slot.worker) {
                const executable = await (this.executable ??=
                    getCoreBinaryPathService(this.binary))
                const worker = await CoreWorker.create(executable)
                slot.worker = worker
                void worker.closed.then(() => {
                    this.slots.delete(slot)
                    this.pump()
                    return undefined
                })
            }
            if (job.finished || this.closing) return
            job.worker = slot.worker
            const value = await slot.worker.run(job.input)
            let validated: unknown
            try {
                validated = job.options.validateResult
                    ? job.options.validateResult(value)
                    : value
            } catch {
                await slot.worker.close()
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Das Ergebnis des Core-Auftrags konnte nicht bestätigt werden.',
                    { uncertain: true },
                )
            }
            this.settle(job, validated)
        } catch (error) {
            if (!slot.worker) this.executable = undefined
            this.settle(job, undefined, error)
        } finally {
            slot.busy = false
            if (this.closing || !slot.worker?.usable) {
                await slot.worker?.close()
                this.slots.delete(slot)
            } else slot.worker.idle()
            this.pump()
        }
    }

    async close() {
        this.closing = true
        for (const job of this.jobs)
            this.cancel(
                job,
                new CoreCommandError(
                    'CORE_CANCELLED',
                    'Der Core-Auftrag wurde beim Herunterfahren abgebrochen.',
                ),
            )
        await Promise.all(
            [...this.slots].map(async (slot) => {
                // Startup is bounded by the worker readiness timer; wait for its owner.
                if (slot.worker) await slot.worker.close()
                await slot.task
            }),
        )
        this.onClosed(this)
    }

    retire() {
        this.retiring = true
        if (this.jobs.size === 0) void this.close()
    }
}

const pools = new Map<string, { binary: CoreBinary; pool: CoreWorkerPool }>()
const allPools = new Set<CoreWorkerPool>()
let closingPools: Promise<void> | undefined

/** Bounded admission includes queued, starting and executing requests. No mutation is retried. */
export function runPooledCoreCommandService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options: CoreCommandOptions = {},
): Promise<unknown> {
    const startedAt = performance.now()
    const logLifecycle = !CORE_RUNTIME.quietOperations[binary].some(
        (operation) => operation === request.operation,
    )
    try {
        options.signal?.throwIfAborted()
        if (closingPools)
            throw new CoreCommandError(
                'CORE_UNAVAILABLE',
                'Der Core-Pool wird heruntergefahren.',
            )
        if (options.environment || options.onProgress)
            throw new CoreCommandError(
                'CORE_INVALID_REQUEST',
                'Der Core-Pool unterstützt keine angepasste Prozessumgebung oder Fortschrittscallbacks.',
            )
        const raw = options.binaryInput
        validateCoreBinaryInputService(
            binary,
            request,
            raw,
            'CORE_REQUEST_TOO_LARGE',
        )
        const payload = JSON.stringify(request)
        const payloadBytes = Buffer.byteLength(payload)
        if (payloadBytes > CORE_RUNTIME.maxRequestBytes)
            throw new CoreCommandError(
                'CORE_REQUEST_TOO_LARGE',
                'Die Core-Anfrage überschreitet das Größenlimit.',
            )
        // NUL cannot appear in environment values or executable paths.
        const key = `${binary}\0${process.env.CORE_BINARY_DIR?.trim() ?? ''}\0${process.env.NODE_ENV ?? ''}\0${CORE_RUNTIME.binaries[binary]}`
        let entry = pools.get(key)
        if (!entry) {
            for (const [oldKey, oldEntry] of pools) {
                if (oldEntry.binary === binary) {
                    oldEntry.pool.retire()
                    pools.delete(oldKey)
                }
            }
            entry = {
                binary,
                pool: new CoreWorkerPool(binary, (pool) => {
                    allPools.delete(pool)
                }),
            }
            allPools.add(entry.pool)
            pools.set(key, entry)
        }
        // The view is never retained: admit synchronously takes an owned snapshot.
        const result = entry.pool.admit(
            {
                payload,
                binaryOutput:
                    binary === 'storage' &&
                    request.operation === 'readBackgroundRepresentation',
                binaryInput:
                    raw === undefined
                        ? undefined
                        : Buffer.from(
                              raw.buffer,
                              raw.byteOffset,
                              raw.byteLength,
                          ),
            },
            payloadBytes + (raw?.byteLength ?? 0),
            options,
        )
        if (logLifecycle) logInfo(`core.${binary}_started`, { service: 'core' })
        return result
            .then((value) => {
                if (logLifecycle)
                    logInfo(`core.${binary}_completed`, {
                        service: 'core',
                        durationMs: Math.round(performance.now() - startedAt),
                    })
                return value
            })
            .catch((error: unknown) => {
                logError(`core.${binary}_failed`, error, {
                    service: 'core',
                    durationMs: Math.round(performance.now() - startedAt),
                })
                throw error
            })
    } catch (error) {
        logError(`core.${binary}_failed`, error, {
            service: 'core',
            durationMs: Math.round(performance.now() - startedAt),
        })
        return Promise.reject(error)
    }
}

export function closeCoreWorkerPoolsService(): Promise<void> {
    if (closingPools) return closingPools
    const closing = [...allPools]
    closingPools = (async () => {
        await Promise.all(closing.map((pool) => pool.close()))
        for (const [key, entry] of pools)
            if (closing.includes(entry.pool)) pools.delete(key)
    })().finally(() => {
        closingPools = undefined
    })
    return closingPools
}
