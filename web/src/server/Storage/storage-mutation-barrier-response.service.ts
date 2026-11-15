import { isRedirect } from '@tanstack/react-router'
import { withSharedStorageMutationBarrier } from './storage-mutation-barrier.service.ts'
import {
    getActiveStorageMutationScopeService,
    markStorageMutationScopeUncertainService,
    runInStorageMutationScopeContextService,
} from './storage-mutation-scope.service.ts'
import type {
    StorageMutationResponseOptions,
    StorageMutationResponseSourceState,
    StorageMutationResponseResult,
} from './Types/storage-mutation-barrier-response.types.ts'

export async function withSharedStorageMutationBarrierResponseService<
    TResult extends StorageMutationResponseResult,
>(
    operation: () => TResult | Promise<TResult>,
    options: StorageMutationResponseOptions = {},
): Promise<TResult> {
    const ready = Promise.withResolvers<TResult>()
    let bodylessResult: TResult | undefined
    let terminate: ((reason: unknown) => Promise<void>) | undefined
    let aborted = options.signal?.aborted === true
    let abortReason = options.signal?.reason
    const onAbort = () => {
        aborted = true
        abortReason = options.signal?.reason
        if (terminate) void terminate(abortReason).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const work: Promise<void> = withSharedStorageMutationBarrier(
        async function () {
            if (aborted) throw abortReason
            const result = await operation()
            const scope = getActiveStorageMutationScopeService()
            if (!scope)
                throw new Error('Storage response scope is unavailable.')
            const activeScope = scope
            const response = result.response
            if (!response.body) {
                if (aborted) throw abortReason
                bodylessResult = result
                return
            }
            if (response.body.locked) {
                markStorageMutationScopeUncertainService(activeScope)
                throw new Error(
                    'Storage response source ownership is unavailable.',
                )
            }

            const reader = response.body.getReader()
            const sourceState: Promise<StorageMutationResponseSourceState> =
                reader.closed.then(
                    () => ({ state: 'closed' }),
                    (error: unknown) => ({ state: 'errored', error }),
                )
            async function cancelSource(reason: unknown): Promise<boolean> {
                try {
                    await runInStorageMutationScopeContextService(
                        activeScope,
                        () => reader.cancel(reason),
                    )
                    return true
                } catch (error) {
                    const terminal = await sourceState
                    if (
                        terminal.state === 'errored' &&
                        terminal.error === error
                    )
                        return true
                    markStorageMutationScopeUncertainService(activeScope)
                    return false
                }
            }
            if (aborted) {
                await cancelSource(abortReason)
                try {
                    reader.releaseLock()
                } catch {
                    markStorageMutationScopeUncertainService(activeScope)
                }
                throw abortReason
            }
            const completed = Promise.withResolvers<void>()
            let pendingRead: Promise<unknown> | null = null
            let finalization: Promise<void> | null = null
            let streamController:
                ReadableStreamDefaultController<Uint8Array> | undefined

            function reportStreamError(error: unknown) {
                try {
                    streamController?.error(error)
                } catch {}
            }

            function finish(
                cancel: boolean,
                error?: unknown,
                failed = false,
            ): Promise<void> {
                if (finalization) return finalization
                finalization = (async function () {
                    let cleanupFailed = false
                    if (cancel) {
                        cleanupFailed = !(await cancelSource(error))
                    }
                    if (pendingRead) await Promise.allSettled([pendingRead])
                    try {
                        reader.releaseLock()
                    } catch {
                        cleanupFailed = true
                        markStorageMutationScopeUncertainService(activeScope)
                    }
                    if (failed || cleanupFailed) {
                        completed.reject(
                            error ??
                                new Error(
                                    'Storage response cleanup was not confirmed.',
                                ),
                        )
                    } else {
                        completed.resolve()
                    }
                    await work
                })()
                return finalization
            }

            let body: ReadableStream<Uint8Array>
            try {
                body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        streamController = controller
                    },
                    async pull(controller) {
                        if (finalization) {
                            await finalization
                            return
                        }
                        try {
                            const read =
                                runInStorageMutationScopeContextService(
                                    activeScope,
                                    () => reader.read(),
                                )
                            pendingRead = read
                            const chunk = await read
                            if (pendingRead === read) pendingRead = null
                            if (finalization) {
                                await finalization
                                return
                            }
                            if (chunk.done) {
                                await finish(false)
                                controller.close()
                                return
                            }
                            controller.enqueue(chunk.value)
                        } catch (error) {
                            await finish(true, error, true).catch(
                                reportStreamError,
                            )
                            reportStreamError(error)
                        }
                    },
                    async cancel(reason) {
                        await finish(true, reason)
                    },
                })
                const forwarded = new Response(body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: new Headers(response.headers),
                })
                const preserved = isRedirect(response)
                    ? Object.assign(forwarded, { options: response.options })
                    : forwarded
                terminate = async function (reason) {
                    try {
                        await finish(true, reason, true)
                    } catch (error) {
                        reportStreamError(error)
                        throw error
                    }
                    reportStreamError(reason)
                }
                if (aborted) {
                    void terminate(abortReason).catch(() => undefined)
                } else {
                    ready.resolve({ ...result, response: preserved })
                }
            } catch (error) {
                await cancelSource(error)
                if (pendingRead) await Promise.allSettled([pendingRead])
                try {
                    reader.releaseLock()
                } catch {
                    markStorageMutationScopeUncertainService(activeScope)
                }
                throw error
            }
            await completed.promise
        },
    )

    void work.then(
        () => {
            options.signal?.removeEventListener('abort', onAbort)
            if (bodylessResult) ready.resolve(bodylessResult)
            return undefined
        },
        (error) => {
            options.signal?.removeEventListener('abort', onAbort)
            ready.reject(error)
            return undefined
        },
    )
    return ready.promise
}
