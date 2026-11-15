import { CORE_RUNTIME } from '@/config/core.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { logError } from '@/server/Logging/logger.ts'
import { writeLinuxPrivateStorageFileService } from './linux-private-write.service.ts'
import type { PrivateStorageFileWriteInput } from './Types/private-files.types.ts'
import type { PrivateWriteJob } from './Types/private-write-queue.types.ts'

const queue: PrivateWriteJob[] = []
const jobs = new Set<PrivateWriteJob>()
const active = new Set<PrivateWriteJob>()
let admittedBytes = 0
let closing: Promise<void> | undefined

function failure(code: string): CoreCommandError {
    return new CoreCommandError(
        code,
        'Die private Dateioperation ist fehlgeschlagen.',
    )
}

function safeError(error: unknown): CoreCommandError {
    return new CoreCommandError(
        error instanceof CoreCommandError &&
            /^(?:CORE_[A-Z_]{1,48}|E[A-Z0-9]{1,24})$/.test(error.code)
            ? error.code
            : 'CORE_IO_ERROR',
        'Die private Dateioperation ist fehlgeschlagen.',
        { uncertain: error instanceof CoreCommandError && error.isUncertain },
    )
}

function settle(job: PrivateWriteJob, error?: CoreCommandError) {
    if (!jobs.delete(job)) return
    clearTimeout(job.timer)
    const index = queue.indexOf(job)
    if (index !== -1) queue.splice(index, 1)
    admittedBytes -= job.bytes
    job.input.data.fill(0)
    if (error === undefined) job.resolve()
    else {
        job.reject(error)
        logError('storage.private_write_failed', error, {
            service: 'storage',
        })
    }
}

function cancel(job: PrivateWriteJob, reason: CoreCommandError) {
    if (!jobs.has(job) || job.cancellation) return
    job.cancellation = reason
    job.controller.abort(reason)
    if (!active.has(job)) settle(job, reason)
}

function check(job: PrivateWriteJob) {
    if (!job.cancellation && performance.now() >= job.deadline)
        cancel(job, failure('CORE_TIMEOUT'))
    if (job.cancellation) throw job.cancellation
}

async function execute(job: PrivateWriteJob) {
    try {
        check(job)
        const written = await writeLinuxPrivateStorageFileService(
            job.input,
            () => check(job),
        )
        if (!written) {
            // A false result guarantees that the Linux path performed no mutation.
            check(job)
            await runCoreCommandService(
                'storage',
                {
                    operation: 'writeFile',
                    rootDirectory: job.input.rootDirectory,
                    filePath: job.input.filePath,
                },
                {
                    binaryInput: job.input.data,
                    timeoutMs: Math.max(1, job.deadline - performance.now()),
                    signal: job.controller.signal,
                },
            )
        }
        // Confirmed publication wins over a deadline that elapsed while I/O drained.
        settle(job)
    } catch (error) {
        settle(job, safeError(error))
    } finally {
        active.delete(job)
        pump()
    }
}

function pump() {
    if (closing) return
    while (queue.length && active.size < CORE_RUNTIME.workerMaxProcesses) {
        const job = queue.shift()
        if (!job) return
        active.add(job)
        // Publish ownership before invoking code that can request shutdown.
        job.task = Promise.resolve().then(() => execute(job))
    }
}

/** Own caller bytes before yielding; queued and executing writes share every bound. */
export function runPrivateStorageWriteService(
    input: PrivateStorageFileWriteInput,
): Promise<void> {
    const deadline = performance.now() + CORE_RUNTIME.commandTimeoutMs
    try {
        if (closing) throw failure('CORE_UNAVAILABLE')
        const { rootDirectory, filePath, data } = input
        if (
            typeof rootDirectory !== 'string' ||
            typeof filePath !== 'string' ||
            !(data instanceof Uint8Array) ||
            data.byteLength > CORE_RUNTIME.maxBinaryInputBytes
        )
            throw failure('CORE_INVALID_REQUEST')
        const metadataBytes = Buffer.byteLength(
            JSON.stringify({ operation: 'writeFile', rootDirectory, filePath }),
        )
        const bytes = metadataBytes + data.byteLength
        if (metadataBytes > CORE_RUNTIME.maxRequestBytes)
            throw failure('CORE_REQUEST_TOO_LARGE')
        if (
            jobs.size >= CORE_RUNTIME.workerMaxQueueSize ||
            bytes > CORE_RUNTIME.workerMaxQueuedBytes - admittedBytes
        )
            throw failure('CORE_BUSY')
        const snapshot = Buffer.from(data)
        return new Promise<void>((resolve, reject) => {
            const job: PrivateWriteJob = {
                input: { rootDirectory, filePath, data: snapshot },
                bytes,
                deadline,
                controller: new AbortController(),
                resolve,
                reject,
            }
            jobs.add(job)
            admittedBytes += bytes
            queue.push(job)
            job.timer = setTimeout(
                () => cancel(job, failure('CORE_TIMEOUT')),
                Math.max(0, deadline - performance.now()),
            )
            pump()
        })
    } catch (error) {
        const sanitized = safeError(error)
        logError('storage.private_write_failed', sanitized, {
            service: 'storage',
        })
        return Promise.reject(sanitized)
    }
}

export function closePrivateStorageWritesService(): Promise<void> {
    if (closing) return closing
    // Install the closing gate before signalling owners or settling queued callers.
    const finished = Promise.withResolvers<void>()
    closing = finished.promise.finally(() => {
        closing = undefined
    })
    for (const job of jobs) cancel(job, failure('CORE_CANCELLED'))
    void Promise.allSettled(
        [...active].map((job) => job.task ?? Promise.resolve()),
    ).then((results) => {
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected')
            finished.reject(safeError(failed.reason))
        else finished.resolve()
        return undefined
    })
    return closing
}
