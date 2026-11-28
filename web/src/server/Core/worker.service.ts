import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmod, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { getCoreCommandEnvironmentService } from './environment.service.ts'
import { CoreCommandError, isUncertainCoreErrorCode } from './error.ts'
import {
    coreBinaryResultFrameSchema,
    coreErrorFrameSchema,
    coreResultFrameSchema,
} from './protocol.ts'
import { logError } from '@/server/Logging/logger.ts'
import type {
    CoreWorkerInput,
    CoreWorkerTerminal,
} from './Types/worker.types.ts'

const frameDecoder = new TextDecoder('utf-8', { fatal: true })
const requestIdSchema = z.number().int().positive().safe()

const frameSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ready'), protocol: z.literal(1) }).strict(),
    z
        .object({
            type: z.literal('progress'),
            requestId: requestIdSchema,
            progress: z.unknown(),
        })
        .strict(),
    coreResultFrameSchema.extend({ requestId: requestIdSchema }),
    coreBinaryResultFrameSchema.extend({ requestId: requestIdSchema }),
    coreErrorFrameSchema.extend({ requestId: requestIdSchema }),
])

function protocolError() {
    return new CoreCommandError(
        'CORE_PROTOCOL_ERROR',
        'Der Rust-Core hat eine ungültige Antwort geliefert.',
        { uncertain: true },
    )
}

function uncertainError() {
    return new CoreCommandError(
        'CORE_OPERATION_UNCERTAIN',
        'Der Abschluss des Core-Auftrags konnte nicht bestätigt werden.',
        { uncertain: true },
    )
}

function isUncertainWorkerError(code: string): boolean {
    return (
        isUncertainCoreErrorCode(code) || code === 'ARCHIVE_CLEANUP_INCOMPLETE'
    )
}

async function assertWorkerDirectory(
    directory: string,
    identity: { dev: bigint; ino: bigint },
) {
    const relative = path.relative(path.resolve(tmpdir()), directory)
    const actual = await lstat(directory, { bigint: true })
    if (
        !relative.startsWith('marketplace-core-worker-') ||
        relative.includes(path.sep) ||
        !actual.isDirectory() ||
        actual.isSymbolicLink() ||
        actual.dev !== identity.dev ||
        actual.ino !== identity.ino
    ) {
        throw new CoreCommandError(
            'CORE_CLEANUP_FAILED',
            'Die private Core-Ablage konnte nicht sicher bereinigt werden.',
        )
    }
}

type ActiveRequest = {
    requestId: number
    cancellationPath: string
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    terminal?: CoreWorkerTerminal
    cancellationReason?: unknown
    cancellationWrite?: Promise<void>
    killTimer?: ReturnType<typeof setTimeout>
    uploaded: boolean
    finishing: boolean
    expectsBinary: boolean
    binary?: { bytes: Buffer; received: number; version: string }
}

const liveWorkers = new Set<CoreWorker>()
process.once('exit', () => {
    for (const worker of liveWorkers) worker.killOnExit()
})
process.on('beforeExit', () => {
    // Unreferenced idle workers must still be reaped and privately cleaned up on natural CLI exit.
    for (const worker of liveWorkers) void worker.close()
})

/** A worker owns its private cancellation directory until every pipe has closed. */
export class CoreWorker {
    private active?: ActiveRequest
    private sequence = 0
    private ready = false
    private poisoned = false
    private exited = false
    private closing = false
    private referenced = true
    private pendingChunks: Buffer[] = []
    private pendingBytes = 0
    private outputBytes = 0
    private errorBytes = 0
    private idleTimer?: ReturnType<typeof setTimeout>
    private exitTimer?: ReturnType<typeof setTimeout>
    private readyTimer?: ReturnType<typeof setTimeout>
    private readyResolve!: () => void
    private readyReject!: (error: unknown) => void
    private readonly readiness: Promise<void>
    private readonly child: ChildProcessWithoutNullStreams
    readonly closed: Promise<void>

    private constructor(
        executable: string,
        private readonly directory: string,
        private readonly identity: { dev: bigint; ino: bigint },
    ) {
        this.readiness = new Promise<void>((resolve, reject) => {
            this.readyResolve = resolve
            this.readyReject = reject
        })
        this.child = spawn(executable, ['worker'], {
            env: getCoreCommandEnvironmentService(),
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        })
        liveWorkers.add(this)
        this.closed = new Promise<void>((resolve) => {
            this.child.once('close', () => {
                const damaged = this.poisoned || this.pendingBytes !== 0
                this.exited = true
                liveWorkers.delete(this)
                this.poisoned = true
                clearTimeout(this.idleTimer)
                clearTimeout(this.readyTimer)
                clearTimeout(this.exitTimer)
                this.readyReject(
                    new CoreCommandError(
                        'CORE_UNAVAILABLE',
                        'Der Rust-Core konnte nicht gestartet werden.',
                    ),
                )
                const active = this.active
                this.active = undefined
                clearTimeout(active?.killTimer)
                // close is emitted only after the process and all owned pipes ended.
                void (async () => {
                    await active?.cancellationWrite
                    await this.assertDirectory()
                    await rm(this.directory, { recursive: true, force: true })
                })()
                    .catch(() => this.logCleanupFailure())
                    .then(() => {
                        if (active?.terminal && active.uploaded && !damaged)
                            this.settleTerminal(active)
                        else {
                            active?.binary?.bytes.fill(0)
                            active?.reject(uncertainError())
                        }
                        resolve()
                        return undefined
                    })
            })
        })
        this.child.once('error', () => {
            this.readyReject(
                new CoreCommandError(
                    'CORE_UNAVAILABLE',
                    'Der Rust-Core konnte nicht gestartet werden.',
                ),
            )
            this.poison(protocolError())
        })
        this.child.stdin.on('error', () => this.poison(uncertainError()))
        this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk))
        this.child.stdout.on('error', () => this.poison(protocolError()))
        this.child.stderr.on('data', (chunk: Buffer) => {
            this.errorBytes += chunk.length
            if (this.errorBytes > CORE_RUNTIME.maxErrorBytes)
                this.poison(protocolError())
        })
        this.child.stderr.on('error', () => this.poison(protocolError()))
        this.readyTimer = setTimeout(() => {
            this.readyReject(
                new CoreCommandError(
                    'CORE_UNAVAILABLE',
                    'Der Rust-Core wurde nicht rechtzeitig bereit.',
                ),
            )
            this.poison(protocolError())
        }, CORE_RUNTIME.workerReadyTimeoutMs)
    }

    static async create(executable: string) {
        const directory = await mkdtemp(
            path.join(tmpdir(), 'marketplace-core-worker-'),
        )
        let worker: CoreWorker | undefined
        let identity: { dev: bigint; ino: bigint } | undefined
        try {
            identity = await lstat(directory, { bigint: true })
            if (process.platform !== 'win32') await chmod(directory, 0o700)
            worker = new CoreWorker(executable, directory, identity)
            await worker.readiness
            return worker
        } catch (error) {
            if (worker) await worker.close()
            else if (identity) {
                await assertWorkerDirectory(directory, identity)
                await rm(directory, { recursive: true, force: true })
            }
            throw error
        }
    }

    private async assertDirectory() {
        await assertWorkerDirectory(this.directory, this.identity)
    }

    private logCleanupFailure() {
        logError(
            'core.worker_cleanup_failed',
            new CoreCommandError(
                'CORE_CLEANUP_FAILED',
                'Die private Core-Ablage konnte nicht sicher bereinigt werden.',
            ),
            { service: 'core' },
        )
    }

    get usable() {
        return (
            this.ready &&
            !this.poisoned &&
            !this.exited &&
            !this.closing &&
            this.sequence < Number.MAX_SAFE_INTEGER
        )
    }

    private reference(referenced: boolean) {
        // Bun's readable pipe ref()/unref() count calls; an already active pipe must not gain another reference.
        if (this.referenced === referenced) return
        this.referenced = referenced
        if (referenced) this.child.ref()
        else this.child.unref()
        for (const stream of [
            this.child.stdin,
            this.child.stdout,
            this.child.stderr,
        ]) {
            const handle = stream as typeof stream & {
                ref?: () => void
                unref?: () => void
            }
            if (referenced) handle.ref?.()
            else handle.unref?.()
        }
    }

    idle() {
        if (!this.usable || this.active) return
        this.reference(false)
        clearTimeout(this.idleTimer)
        this.idleTimer = setTimeout(() => {
            void this.close()
        }, CORE_RUNTIME.workerIdleTimeoutMs)
        this.idleTimer.unref?.()
    }

    run(input: CoreWorkerInput): Promise<unknown> {
        if (!this.usable || this.active) return Promise.reject(uncertainError())
        if (this.pendingBytes) {
            this.poison(protocolError())
            return this.closed.then(() => Promise.reject(protocolError()))
        }
        clearTimeout(this.idleTimer)
        this.reference(true)
        this.outputBytes = 0
        this.errorBytes = 0
        const requestId = ++this.sequence
        return new Promise((resolve, reject) => {
            const active: ActiveRequest = {
                requestId,
                cancellationPath: path.join(
                    this.directory,
                    `cancel-${requestId}`,
                ),
                resolve,
                reject,
                uploaded: false,
                finishing: false,
                expectsBinary: input.binaryOutput,
            }
            this.active = active
            const header = `{"requestId":${requestId},"cancellationPath":${JSON.stringify(active.cancellationPath)},"request":${input.payload}${input.binaryInput === undefined ? '' : `,"binaryBytes":${input.binaryInput.length}`}}\n`
            if (
                Buffer.byteLength(header) >
                CORE_RUNTIME.maxRequestBytes + 64 * 1024
            ) {
                this.active = undefined
                reject(
                    new CoreCommandError(
                        'CORE_REQUEST_TOO_LARGE',
                        'Die Core-Anfrage überschreitet das Größenlimit.',
                    ),
                )
                return
            }
            void (async () => {
                await this.write(header)
                if (input.binaryInput?.length)
                    await this.write(input.binaryInput)
                active.uploaded = true
                this.finish(active)
            })().catch(() => this.poison(uncertainError()))
        })
    }

    private write(value: string | Buffer) {
        // The write callback follows real stream backpressure, including pipe failures.
        return new Promise<void>((resolve, reject) => {
            this.child.stdin.write(value, (error) => {
                if (error) reject(error)
                else resolve()
            })
        })
    }

    cancel(reason: unknown) {
        const active = this.active
        if (
            !active ||
            active.terminal ||
            active.cancellationWrite ||
            this.poisoned
        )
            return
        active.cancellationReason = reason
        active.cancellationWrite = writeFile(active.cancellationPath, '', {
            flag: 'wx',
            mode: 0o600,
        }).catch(() => undefined)
        active.killTimer = setTimeout(
            () => this.poison(uncertainError()),
            CORE_RUNTIME.cancellationGraceMs,
        )
    }

    private consume(bytes: Buffer) {
        if (this.poisoned) return // Keep draining the pipes while the process is being reaped.
        this.outputBytes += bytes.length
        if (this.outputBytes > CORE_RUNTIME.maxOutputBytes)
            return this.poison(protocolError())
        let offset = 0
        while (offset < bytes.length) {
            const receiving = this.active
            if (receiving?.binary && !receiving.terminal) {
                const binary = receiving.binary
                const length = Math.min(
                    bytes.length - offset,
                    binary.bytes.length - binary.received,
                )
                bytes.copy(
                    binary.bytes,
                    binary.received,
                    offset,
                    offset + length,
                )
                binary.received += length
                offset += length
                if (binary.received === binary.bytes.length) {
                    this.finishBinary(receiving, binary)
                }
                continue
            }
            const newline = bytes.indexOf(10, offset)
            const end = newline === -1 ? bytes.length : newline
            const length = this.pendingBytes + end - offset
            if (length > CORE_RUNTIME.maxRecordBytes)
                return this.poison(protocolError())
            if (end > offset)
                this.pendingChunks.push(bytes.subarray(offset, end))
            this.pendingBytes = length
            if (newline === -1) {
                return
            }
            // Accumulate fragments without repeatedly copying an ever-growing prefix.
            const record =
                this.pendingChunks.length === 1
                    ? this.pendingChunks[0]
                    : Buffer.concat(this.pendingChunks, this.pendingBytes)
            this.pendingChunks = []
            this.pendingBytes = 0
            try {
                const value: unknown = JSON.parse(frameDecoder.decode(record))
                const message = frameSchema.parse(value)
                if (!this.ready) {
                    if (message.type !== 'ready') throw protocolError()
                    this.ready = true
                    clearTimeout(this.readyTimer)
                    this.readyResolve()
                } else {
                    const active = this.active
                    if (
                        !active ||
                        message.type === 'ready' ||
                        message.requestId !== active.requestId ||
                        active.terminal
                    )
                        throw protocolError()
                    if (message.type === 'binaryResult') {
                        if (!active.expectsBinary) throw protocolError()
                        const binary = {
                            bytes: Buffer.alloc(message.binaryBytes),
                            received: 0,
                            version: message.version,
                        }
                        active.binary = binary
                        if (!binary.bytes.length)
                            this.finishBinary(active, binary)
                    } else if (message.type !== 'progress') {
                        if (
                            active.expectsBinary &&
                            message.type === 'result' &&
                            message.result !== null
                        )
                            throw protocolError()
                        active.terminal = message
                        clearTimeout(active.killTimer)
                        this.finish(active)
                    }
                }
            } catch {
                this.readyReject(
                    new CoreCommandError(
                        'CORE_UNAVAILABLE',
                        'Das Core-Protokoll ist nicht kompatibel.',
                    ),
                )
                return this.poison(protocolError())
            }
            offset = end + 1
        }
    }

    private finishBinary(
        active: ActiveRequest,
        binary: { bytes: Buffer; version: string },
    ) {
        active.terminal = {
            type: 'result',
            requestId: active.requestId,
            result: { version: binary.version, bytes: binary.bytes },
        }
        clearTimeout(active.killTimer)
        this.finish(active)
    }

    private finish(active: ActiveRequest) {
        const terminal = active.terminal
        if (!terminal || !active.uploaded || active.finishing) return
        active.finishing = true
        // Process every record already buffered before releasing this worker for reuse.
        queueMicrotask(() => {
            void (async () => {
                await active.cancellationWrite
                if (this.poisoned || this.active !== active) return
                if (this.pendingBytes) return this.poison(protocolError())
                if (active.cancellationWrite) {
                    try {
                        await this.assertDirectory()
                        await rm(active.cancellationPath, { force: true })
                    } catch {
                        // The native terminal remains authoritative; retire the local worker.
                        this.logCleanupFailure()
                        this.closing = true
                    }
                }
                if (this.poisoned || this.active !== active) return
                clearTimeout(active.killTimer)
                if (
                    terminal.type === 'error' &&
                    isUncertainWorkerError(terminal.error.code)
                ) {
                    return this.poison(
                        new CoreCommandError(
                            terminal.error.code,
                            terminal.error.message,
                            { uncertain: true },
                        ),
                    )
                }
                this.active = undefined
                this.settleTerminal(active, terminal)
                if (this.closing) this.endIdleWorker()
            })().catch(() => this.poison(protocolError()))
        })
    }

    private settleTerminal(
        active: ActiveRequest,
        terminal: CoreWorkerTerminal | undefined = active.terminal,
    ) {
        if (!terminal) {
            active.reject(protocolError())
            return
        }
        if (terminal.type === 'result') active.resolve(terminal.result)
        else {
            const uncertain = isUncertainWorkerError(terminal.error.code)
            const error = new CoreCommandError(
                terminal.error.code,
                terminal.error.message,
                { uncertain },
            )
            active.reject(
                !uncertain &&
                    error.code === 'CORE_CANCELLED' &&
                    active.cancellationReason !== undefined
                    ? active.cancellationReason
                    : error,
            )
        }
    }

    private poison(error: CoreCommandError) {
        if (this.poisoned) return
        this.reference(true)
        this.poisoned = true
        clearTimeout(this.readyTimer)
        clearTimeout(this.idleTimer)
        clearTimeout(this.exitTimer)
        this.readyReject(error)
        const active = this.active
        // Keep the request owned until close and directory cleanup confirm termination.
        if (active) {
            const reject = active.reject
            active.reject = () => reject(error)
        }
        if (!this.exited) this.child.kill('SIGKILL')
    }

    private endIdleWorker() {
        this.exitTimer = setTimeout(
            () => this.poison(uncertainError()),
            CORE_RUNTIME.workerExitTimeoutMs,
        )
        this.child.stdin.end()
    }

    close(): Promise<void> {
        if (this.closing || this.exited || this.poisoned) return this.closed
        this.closing = true
        this.reference(true)
        clearTimeout(this.idleTimer)
        if (this.active) {
            this.cancel(
                new CoreCommandError(
                    'CORE_CANCELLED',
                    'Der Core-Auftrag wurde beim Herunterfahren abgebrochen.',
                ),
            )
        } else if (this.ready) {
            this.endIdleWorker()
        } else {
            this.poison(uncertainError())
        }
        return this.closed
    }

    killOnExit() {
        if (!this.exited) this.child.kill('SIGKILL')
    }
}
