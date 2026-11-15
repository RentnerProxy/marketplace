/* eslint-disable no-await-in-loop -- Session responses must be consumed in protocol order. */
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { getCoreBinaryPathService } from './binary.service.ts'
import { getCoreCommandEnvironmentService } from './environment.service.ts'
import { CoreCommandError, isUncertainCoreErrorCode } from './error.ts'
import { coreErrorSchema } from './protocol.ts'
import type { CoreBinary } from './Types/core.types.ts'
import type { CoreSession, CoreSessionOptions } from './Types/session.types.ts'

const responseSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('result'),
            requestId: z
                .number()
                .int()
                .positive()
                .max(CORE_RUNTIME.maxSessionRequests),
            result: z.unknown(),
        })
        .strict(),
    z
        .object({
            type: z.literal('error'),
            requestId: z
                .number()
                .int()
                .positive()
                .max(CORE_RUNTIME.maxSessionRequests),
            error: coreErrorSchema,
        })
        .strict(),
])

function protocolError() {
    return new CoreCommandError(
        'CORE_PROTOCOL_ERROR',
        'Die Antwort der Core-Sitzung konnte nicht bestätigt werden.',
        { uncertain: true },
    )
}

function encodeRequest(request: Record<string, unknown>, requestId: number) {
    const payload = JSON.stringify({ ...request, requestId }) + '\n'
    if (Buffer.byteLength(payload) > CORE_RUNTIME.maxSessionRecordBytes)
        throw new CoreCommandError(
            'CORE_REQUEST_TOO_LARGE',
            'Die Core-Anfrage überschreitet das Größenlimit.',
        )
    return payload
}

export async function openCoreSessionService(
    binary: CoreBinary,
    args: readonly string[],
    initialRequest: Record<string, unknown>,
    options: CoreSessionOptions,
): Promise<CoreSession> {
    options.signal?.throwIfAborted()
    const initialPayload = encodeRequest(initialRequest, 1)
    const executable = await getCoreBinaryPathService(binary)
    const directory = await mkdtemp(
        path.join(tmpdir(), 'marketplace-core-session-'),
    )
    const cancellationPath = path.join(directory, 'cancel')
    let child: ReturnType<typeof spawn> & {
        stdin: NonNullable<ReturnType<typeof spawn>['stdin']>
        stdout: NonNullable<ReturnType<typeof spawn>['stdout']>
        stderr: NonNullable<ReturnType<typeof spawn>['stderr']>
    }
    try {
        if (process.platform !== 'win32') await chmod(directory, 0o700)
        child = spawn(executable, [...args], {
            env: {
                ...getCoreCommandEnvironmentService(),
                MARKETPLACE_CORE_CANCEL_FILE: cancellationPath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        })
    } catch {
        await rm(directory, { recursive: true, force: true })
        throw new CoreCommandError(
            'CORE_UNAVAILABLE',
            'Der Rust-Core konnte nicht gestartet werden.',
        )
    }
    let failure: unknown
    let exited = false
    let closing = false
    let closeAcknowledged = false
    let pendingCount = 0
    let nextRequestId = 2
    let active:
        | {
              final: boolean
              requestId: number
              resolve: (value: unknown) => void
              reject: (error: unknown) => void
          }
        | undefined
    let responseTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let cancellationWrite: Promise<void> | undefined
    const startedAt = performance.now()
    const exit = new Promise<number>((resolve) => {
        child.once('exit', (code) => {
            exited = true
            resolve(code ?? 1)
        })
        child.once('error', () => {
            exited = true
            stop(
                new CoreCommandError(
                    'CORE_UNAVAILABLE',
                    'Der Rust-Core konnte nicht gestartet werden.',
                ),
            )
            resolve(1)
        })
    })

    function stop(error: unknown) {
        const first = !failure
        if (error instanceof CoreCommandError && error.isUncertain)
            failure = error
        else failure ??= error
        clearTimeout(responseTimer)
        active?.reject(failure)
        active = undefined
        if (first)
            logError(`core.${binary}_session_failed`, failure, {
                service: 'core',
            })
        if (exited || cancellationWrite) return
        // Closing stdin wakes a session waiting for its next command. A marker
        // also reaches work currently running inside the native operation.
        // eslint-disable-next-line promise/no-promise-in-callback -- Synchronous cancellation callbacks must persist the marker without blocking.
        cancellationWrite = writeFile(cancellationPath, '', {
            flag: 'wx',
            mode: 0o600,
        }).catch(() => undefined)
        child.stdin.end()
        killTimer = setTimeout(() => {
            if (exited) return
            failure = new CoreCommandError(
                'CORE_OPERATION_UNCERTAIN',
                'Die Core-Sitzung konnte nicht kontrolliert beendet werden.',
                { uncertain: true },
            )
            child.kill('SIGKILL')
        }, CORE_RUNTIME.cancellationGraceMs)
    }
    function abort() {
        stop(
            new CoreCommandError(
                'CORE_CANCELLED',
                'Die Core-Sitzung wurde abgebrochen.',
                { uncertain: true },
            ),
        )
    }
    const deadline = setTimeout(
        () =>
            stop(
                new CoreCommandError(
                    'CORE_TIMEOUT',
                    'Die Core-Sitzung hat ihr Zeitlimit überschritten.',
                    { uncertain: true },
                ),
            ),
        CORE_RUNTIME.commandTimeoutMs,
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdin.on('error', () =>
        stop(
            new CoreCommandError(
                'CORE_TRANSPORT_ERROR',
                'Die Core-Anfrage konnte nicht vollständig übertragen werden.',
                { uncertain: true },
            ),
        ),
    )

    function consume(line: string) {
        if (!line.trim() || !active) throw protocolError()
        let value: unknown
        try {
            value = JSON.parse(line)
        } catch {
            throw protocolError()
        }
        const parsed = responseSchema.safeParse(value)
        if (!parsed.success) throw protocolError()
        if (parsed.data.requestId !== active.requestId) throw protocolError()
        if (parsed.data.type === 'error') {
            const { code, message } = parsed.data.error
            stop(
                new CoreCommandError(code, message, {
                    uncertain:
                        isUncertainCoreErrorCode(code) ||
                        code === 'CORE_PROTOCOL_ERROR',
                }),
            )
            return
        }
        const current = active
        active = undefined
        clearTimeout(responseTimer)
        if (current.final) closeAcknowledged = true
        current.resolve(parsed.data.result)
    }
    const output = (async () => {
        const decoder = new StringDecoder('utf8')
        let buffered = ''
        let total = 0
        for await (const chunk of child.stdout) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            total += bytes.length
            if (total > CORE_RUNTIME.maxOutputBytes) throw protocolError()
            buffered += decoder.write(bytes)
            let end = buffered.indexOf('\n')
            while (end !== -1) {
                if (
                    Buffer.byteLength(buffered.slice(0, end)) >
                    CORE_RUNTIME.maxSessionRecordBytes
                )
                    throw protocolError()
                consume(buffered.slice(0, end))
                buffered = buffered.slice(end + 1)
                end = buffered.indexOf('\n')
            }
            if (
                Buffer.byteLength(buffered) > CORE_RUNTIME.maxSessionRecordBytes
            )
                throw protocolError()
        }
        buffered += decoder.end()
        if (buffered.length) throw protocolError()
    })().catch((error: unknown) => {
        stop(error)
        child.stdout.destroy()
    })
    const diagnostics = (async () => {
        let total = 0
        for await (const chunk of child.stderr) {
            total += Buffer.byteLength(chunk)
            if (total > CORE_RUNTIME.maxErrorBytes) {
                stop(protocolError())
                child.stderr.destroy()
                return
            }
        }
    })().catch(() => stop(protocolError()))
    const completion = Promise.all([exit, output, diagnostics]).then(
        async ([code]) => {
            if (!failure && (!closeAcknowledged || code !== 0))
                stop(protocolError())
            clearTimeout(deadline)
            clearTimeout(responseTimer)
            clearTimeout(killTimer)
            options.signal?.removeEventListener('abort', abort)
            await cancellationWrite
            // Only remove this session's own mkdtemp directory after process exit.
            const relative = path.relative(path.resolve(tmpdir()), directory)
            if (
                relative.startsWith('marketplace-core-session-') &&
                !relative.includes(path.sep)
            ) {
                try {
                    await rm(directory, { recursive: true, force: true })
                } catch {
                    stop(
                        new CoreCommandError(
                            'CORE_CLEANUP_INCOMPLETE',
                            'Die temporäre Core-Ablage konnte nicht entfernt werden.',
                        ),
                    )
                }
            }
            return code
        },
    )

    function exchange(
        payload: string,
        final: boolean,
        requestId: number,
    ): Promise<unknown> {
        if (failure) return Promise.reject(failure)
        if (exited) return Promise.reject(protocolError())
        return new Promise((resolve, reject) => {
            active = { resolve, reject, final, requestId }
            responseTimer = setTimeout(
                () =>
                    stop(
                        new CoreCommandError(
                            'CORE_TIMEOUT',
                            'Die Core-Antwort hat ihr Zeitlimit überschritten.',
                            { uncertain: true },
                        ),
                    ),
                options.timeoutMs ?? CORE_RUNTIME.sessionCommandTimeoutMs,
            )
            child.stdin.write(payload)
        })
    }

    let tail: Promise<void> = Promise.resolve()
    function request<TResult>(
        input: Record<string, unknown>,
        validateResult: (value: unknown) => TResult,
        final = false,
    ): Promise<TResult> {
        if (failure) return Promise.reject(failure)
        if (closing)
            return Promise.reject(
                new CoreCommandError(
                    'CORE_SESSION_CLOSED',
                    'Die Core-Sitzung ist bereits geschlossen.',
                ),
            )
        if (pendingCount >= CORE_RUNTIME.maxSessionPendingRequests)
            return Promise.reject(
                new CoreCommandError(
                    'CORE_SESSION_BUSY',
                    'Die Core-Sitzung hat ihr Anfragelimit erreicht.',
                ),
            )
        // Reserve the final request for a verified close and descriptor release.
        if (nextRequestId > CORE_RUNTIME.maxSessionRequests - (final ? 0 : 1))
            return Promise.reject(
                new CoreCommandError(
                    'CORE_REQUEST_TOO_LARGE',
                    'Die Core-Sitzung hat ihr Anfragelimit erreicht.',
                ),
            )
        let payload: string
        const requestId = nextRequestId
        try {
            payload = encodeRequest(input, requestId)
        } catch (error) {
            return Promise.reject(error)
        }
        nextRequestId++
        if (final) closing = true
        pendingCount++
        const result = tail
            .then(async () => {
                const response = await exchange(payload, final, requestId)
                if (failure) throw failure
                let validated: TResult
                try {
                    validated = validateResult(response)
                } catch {
                    stop(protocolError())
                    throw failure
                }
                if (final) {
                    child.stdin.end()
                    await completion
                    if (failure) throw failure
                    logInfo(`core.${binary}_session_completed`, {
                        service: 'core',
                        durationMs: Math.round(performance.now() - startedAt),
                    })
                } else if (exited) {
                    stop(protocolError())
                    throw failure
                }
                return validated
            })
            .catch(async (error: unknown) => {
                if (failure) {
                    await completion
                    throw failure
                }
                throw error
            })
            .finally(() => {
                pendingCount--
            })
        tail = result.then(
            () => undefined,
            () => undefined,
        )
        return result
    }

    try {
        logInfo(`core.${binary}_session_started`, { service: 'core' })
        if (options.signal?.aborted) abort()
        const ready = await exchange(initialPayload, false, 1)
        if (failure || exited) throw failure ?? protocolError()
        try {
            options.validateReady(ready)
        } catch {
            throw protocolError()
        }
    } catch (error) {
        stop(error)
        await completion
        throw failure
    }
    return {
        request,
        close: async (input, validateResult) => {
            await request(input, validateResult, true)
        },
        abort: async () => {
            if (!exited) abort()
            await completion
        },
    }
}
