/* eslint-disable no-await-in-loop -- Native progress and terminal records must be consumed in protocol order. */
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { getCoreBinaryPathService } from './binary.service.ts'
import { getCoreCommandEnvironmentService } from './environment.service.ts'
import { CoreCommandError, isUncertainCoreErrorCode } from './error.ts'
import { coreErrorSchema } from './protocol.ts'
import type { CoreBinary, CoreCommandOptions } from './Types/core.types.ts'
import { logInfo, logError } from '@/server/Logging/logger.ts'

const messageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('progress'), progress: z.unknown() }).strict(),
    z.object({ type: z.literal('result'), result: z.unknown() }).strict(),
    z
        .object({
            type: z.literal('error'),
            error: coreErrorSchema,
        })
        .strict(),
])

export function runOneShotCoreCommandService<TResult>(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options: CoreCommandOptions<TResult> & {
        validateResult: (value: unknown) => TResult
    },
): Promise<TResult>
export function runOneShotCoreCommandService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options?: CoreCommandOptions,
): Promise<unknown>
export async function runOneShotCoreCommandService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options: CoreCommandOptions = {},
): Promise<unknown> {
    options.signal?.throwIfAborted()
    const executable = await getCoreBinaryPathService(binary)
    const payload = JSON.stringify(request)
    if (Buffer.byteLength(payload) > CORE_RUNTIME.maxRequestBytes) {
        throw new CoreCommandError(
            'CORE_REQUEST_TOO_LARGE',
            'Die Core-Anfrage überschreitet das Größenlimit.',
        )
    }
    const directory = await mkdtemp(
        path.join(tmpdir(), 'marketplace-core-command-'),
    )
    if (process.platform !== 'win32') await chmod(directory, 0o700)
    const cancellationPath = path.join(directory, 'cancel')
    let failure: unknown
    let cancellationWrite: Promise<void> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let result: unknown
    let terminalReceived = false
    let nativeFailure: CoreCommandError | undefined
    let outputBytes = 0
    let interruptProgress: (() => void) | undefined
    const startedAt = performance.now()
    const logLifecycle = !CORE_RUNTIME.quietOperations[binary].some(
        (operation) => operation === request.operation,
    )
    if (logLifecycle) logInfo(`core.${binary}_started`, { service: 'core' })
    const child = spawn(executable, [], {
        env: {
            ...getCoreCommandEnvironmentService(options.environment),
            MARKETPLACE_CORE_CANCEL_FILE: cancellationPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    })
    let exited = false
    const exit = new Promise<number>((resolve) => {
        child.once('exit', (code) => {
            exited = true
            interruptProgress?.()
            resolve(code ?? 1)
        })
        child.once('error', () => {
            exited = true
            interruptProgress?.()
            failure ??= new CoreCommandError(
                'CORE_UNAVAILABLE',
                'Der Rust-Core konnte nicht gestartet werden.',
            )
            resolve(1)
        })
    })
    function cancel(error: unknown) {
        if (error instanceof CoreCommandError && error.isUncertain)
            failure = error
        else failure ??= error
        interruptProgress?.()
        if (cancellationWrite || exited) return
        // A signal callback must persist cancellation without blocking the event loop.
        // eslint-disable-next-line promise/no-promise-in-callback
        cancellationWrite = writeFile(cancellationPath, '', {
            flag: 'wx',
            mode: 0o600,
        }).catch(() => undefined)
        killTimer = setTimeout(() => {
            if (exited) return
            failure = new CoreCommandError(
                'CORE_OPERATION_UNCERTAIN',
                'Der Core-Auftrag konnte nicht kontrolliert beendet werden.',
                { uncertain: true },
            )
            child.kill('SIGKILL')
        }, CORE_RUNTIME.cancellationGraceMs)
    }
    function abort() {
        cancel(
            options.signal?.reason ??
                new CoreCommandError(
                    'CORE_CANCELLED',
                    'Der Core-Auftrag wurde abgebrochen.',
                ),
        )
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    const deadline = setTimeout(
        () =>
            cancel(
                new CoreCommandError(
                    'CORE_TIMEOUT',
                    'Der Core-Auftrag hat sein Zeitlimit überschritten.',
                ),
            ),
        options.timeoutMs ?? CORE_RUNTIME.commandTimeoutMs,
    )
    child.stdin.on('error', () => {
        if (!terminalReceived && !exited)
            cancel(
                new CoreCommandError(
                    'CORE_TRANSPORT_ERROR',
                    'Die Core-Anfrage konnte nicht vollständig übertragen werden.',
                ),
            )
    })
    const output = (async function () {
        const decoder = new StringDecoder('utf8')
        let pending = ''
        async function consume(line: string) {
            if (!line.trim()) return
            if (terminalReceived)
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Der Rust-Core hat eine ungültige Antwort geliefert.',
                    { uncertain: true },
                )
            let value: unknown
            try {
                value = JSON.parse(line)
            } catch {
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Der Rust-Core hat eine ungültige Antwort geliefert.',
                    { uncertain: true },
                )
            }
            const parsed = messageSchema.safeParse(value)
            if (!parsed.success)
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Der Rust-Core hat eine ungültige Antwort geliefert.',
                    { uncertain: true },
                )
            const message = parsed.data
            if (message.type === 'progress') {
                if (!failure) {
                    try {
                        const callback = Promise.resolve(
                            options.onProgress?.(message.progress),
                        ).then(
                            () => undefined,
                            (error: unknown) => ({ error }),
                        )
                        const interrupted = new Promise<undefined>(
                            (resolve) => {
                                interruptProgress = () => resolve(undefined)
                                if (exited || failure) interruptProgress()
                            },
                        )
                        const outcome = await Promise.race([
                            callback,
                            interrupted,
                        ]).finally(() => {
                            interruptProgress = undefined
                        })
                        if (outcome) cancel(outcome.error)
                    } catch (error) {
                        cancel(error)
                    }
                }
            } else {
                terminalReceived = true
                if (message.type === 'error')
                    nativeFailure = new CoreCommandError(
                        message.error.code,
                        message.error.message,
                        {
                            uncertain: isUncertainCoreErrorCode(
                                message.error.code,
                            ),
                        },
                    )
                else result = message.result
            }
        }
        for await (const chunk of child.stdout) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            outputBytes += bytes.length
            if (outputBytes > CORE_RUNTIME.maxOutputBytes)
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Die Core-Antwort überschreitet das Größenlimit.',
                    { uncertain: true },
                )
            pending += decoder.write(bytes)
            let end = pending.indexOf('\n')
            while (end !== -1) {
                if (end > CORE_RUNTIME.maxRecordBytes)
                    throw new CoreCommandError(
                        'CORE_PROTOCOL_ERROR',
                        'Die Core-Antwort überschreitet das Größenlimit.',
                        { uncertain: true },
                    )
                await consume(pending.slice(0, end))
                pending = pending.slice(end + 1)
                end = pending.indexOf('\n')
            }
            if (pending.length > CORE_RUNTIME.maxRecordBytes)
                throw new CoreCommandError(
                    'CORE_PROTOCOL_ERROR',
                    'Die Core-Antwort überschreitet das Größenlimit.',
                    { uncertain: true },
                )
        }
        pending += decoder.end()
        if (pending.trim()) await consume(pending)
    })().catch((error: unknown) => {
        cancel(error)
        child.stdout.destroy()
    })
    const errors = (async function () {
        let observedBytes = 0
        for await (const chunk of child.stderr) {
            observedBytes += Buffer.byteLength(chunk)
            if (observedBytes > CORE_RUNTIME.maxErrorBytes) {
                cancel(
                    new CoreCommandError(
                        'CORE_PROTOCOL_ERROR',
                        'Die Core-Diagnose überschreitet das Größenlimit.',
                        { uncertain: true },
                    ),
                )
                child.stderr.destroy()
                return
            }
        }
    })().catch(() => undefined)
    try {
        if (options.signal?.aborted) abort()
        child.stdin.end(payload)
        const [exitCode] = await Promise.all([exit, output, errors])
        await cancellationWrite
        if (failure instanceof CoreCommandError && failure.isUncertain)
            throw failure
        if (!terminalReceived) {
            if (!child.pid && failure) throw failure
            throw new CoreCommandError(
                'CORE_OPERATION_UNCERTAIN',
                'Der Abschluss des Core-Auftrags konnte nicht bestätigt werden.',
                { uncertain: true },
            )
        }
        if (nativeFailure) {
            if (
                !nativeFailure.isUncertain &&
                nativeFailure.code === 'CORE_CANCELLED' &&
                failure
            )
                throw failure
            throw nativeFailure
        }
        if (exitCode !== 0)
            throw new CoreCommandError(
                'CORE_OPERATION_UNCERTAIN',
                'Der Abschluss des Core-Auftrags konnte nicht bestätigt werden.',
                { uncertain: true },
            )
        let validated: unknown
        try {
            validated = options.validateResult
                ? options.validateResult(result)
                : result
        } catch {
            throw new CoreCommandError(
                'CORE_PROTOCOL_ERROR',
                'Das Ergebnis des Core-Auftrags konnte nicht bestätigt werden.',
                { uncertain: true },
            )
        }
        // Ein bestätigtes Ergebnis hat Vorrang vor einem zu spät eingetroffenen Abbruch;
        // insbesondere müssen Recovery-Handles für einen möglichen Rollback erhalten bleiben.
        if (logLifecycle)
            logInfo(`core.${binary}_completed`, {
                service: 'core',
                durationMs: Math.round(performance.now() - startedAt),
            })
        return validated
    } catch (error) {
        logError(`core.${binary}_failed`, error, {
            service: 'core',
            durationMs: Math.round(performance.now() - startedAt),
        })
        throw error
    } finally {
        clearTimeout(deadline)
        clearTimeout(killTimer)
        options.signal?.removeEventListener('abort', abort)
        // Die private Ablage stammt ausschließlich aus mkdtemp; erst nach Prozessende löschen.
        const parent = path.resolve(tmpdir())
        const relative = path.relative(parent, directory)
        if (
            exited &&
            relative.startsWith('marketplace-core-command-') &&
            !relative.includes(path.sep)
        ) {
            await rm(directory, { recursive: true, force: true })
        }
    }
}
