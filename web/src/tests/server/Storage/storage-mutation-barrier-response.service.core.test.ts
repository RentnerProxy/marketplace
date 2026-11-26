import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { redirect, isRedirect } from '@tanstack/react-router'
import { createMiddleware, createStart } from '@tanstack/react-start'
import {
    createServerEntry,
    createStartHandler,
} from '@tanstack/react-start/server'
import {
    markUnhealthy,
    reserve,
    resetStorageMutationSqlModelService,
    sqlModel,
    waitForStorageMutationTestConditionService as waitFor,
} from './storageMutationSqlModel.test.helpers.ts'
import {
    cleanupStorageMutationTestDirectoryService,
    createStorageMutationTestDirectoryService,
} from './storageMutationFence.test.helpers.ts'
import type { StorageMutationTestDirectory } from './storageMutationFence.test.types.ts'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'

const {
    drainSharedStorageMutationBarrierService: drainShared,
    StorageMutationBarrierUnavailableError,
    withSharedStorageMutationBarrier: shared,
    withExclusiveStorageMutationBarrier: exclusive,
} = await import('@/server/Storage/storage-mutation-barrier.service.ts')
const { withSharedStorageMutationBarrierResponseService: protect } =
    await import('@/server/Storage/storage-mutation-barrier-response.service.ts')

const frameworkTerminal = vi.fn(async function (_request: Request) {
    return new Response('Synthetic framework response')
})
vi.mock('#tanstack-router-entry', () => ({
    getRouter() {
        throw new Error('The terminal middleware must handle the request')
    },
}))
vi.mock('#tanstack-start-plugin-adapters', () => ({
    hasPluginAdapters: false,
    pluginSerializationAdapters: [],
}))
vi.mock('tanstack-start-manifest:v', () => ({
    tsrStartManifest: () => ({ routes: {} }),
}))
vi.mock('#tanstack-start-entry', () => ({
    startInstance: createStart(() => ({
        requestMiddleware: [
            createMiddleware({ type: 'request' }).server(({ request, next }) =>
                protect(next, { signal: request.signal }),
            ),
            createMiddleware({ type: 'request' }).server(({ request }) =>
                frameworkTerminal(request),
            ),
        ],
    })),
}))
const frameworkEntry = createServerEntry({
    fetch: createStartHandler(() => {
        throw new Error('The renderer must not run')
    }),
})

let fixture: StorageMutationTestDirectory

function exclusivePublished() {
    return Bun.file(
        path.join(fixture.rootDirectory, config.exclusiveFileName),
    ).exists()
}

beforeEach(async function () {
    fixture = await createStorageMutationTestDirectoryService()
    resetStorageMutationSqlModelService(fixture.rootDirectory)
})

afterEach(async function () {
    try {
        if (sqlModel.healthy) await drainShared()
        else
            await expect(drainShared()).rejects.toBeInstanceOf(
                StorageMutationBarrierUnavailableError,
            )
        expect(sqlModel.waiters).toHaveLength(0)
    } finally {
        await cleanupStorageMutationTestDirectoryService(fixture)
    }
})

describe('response lifetime storage fencing', function () {
    it('transfers a reader-wrapped body through the real Start middleware pipeline until EOF', async function () {
        const produced =
            Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
        const cancel = vi.fn()
        frameworkTerminal.mockImplementationOnce(
            async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            produced.resolve(controller)
                        },
                        cancel,
                    }),
                    {
                        headers: {
                            'set-cookie': 'synthetic_stream=1; HttpOnly',
                        },
                    },
                ),
        )
        const response = await frameworkEntry.fetch(
            new Request('https://app.example.test/stream'),
            {},
        )
        expect(response.status).toBe(200)
        expect(response.headers.getSetCookie()).toEqual([
            'synthetic_stream=1; HttpOnly',
        ])
        expect(cancel).not.toHaveBeenCalled()
        const restored = exclusive(async () => true)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        const body = response.text()
        const controller = await produced.promise
        controller.enqueue(
            new TextEncoder().encode('Synthetic streamed content'),
        )
        controller.close()
        expect(await body).toBe('Synthetic streamed content')
        expect(await restored).toBe(true)
        expect(cancel).not.toHaveBeenCalled()
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('waits for source cancellation before releasing a real Start response fence', async function () {
        const cleanup = Promise.withResolvers<void>()
        const cancel = vi.fn(() => cleanup.promise)
        frameworkTerminal.mockImplementationOnce(
            async () =>
                new Response(new ReadableStream<Uint8Array>({ cancel })),
        )
        const response = await frameworkEntry.fetch(
            new Request('https://app.example.test/stream'),
            {},
        )
        const canceled = response.body!.cancel(
            'Synthetic framework cancellation',
        )
        await waitFor(() => cancel.mock.calls.length === 1)
        const restored = exclusive(async () => true)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        cleanup.resolve()
        await canceled
        expect(await restored).toBe(true)
        expect(cancel).toHaveBeenCalledWith('Synthetic framework cancellation')
        expect(markUnhealthy).not.toHaveBeenCalled()
    })
    it('returns an unbuffered response and keeps its lease until body completion', async function () {
        const produced =
            Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
        const response = await protect(async function () {
            return {
                context: { preserved: true },
                response: new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            produced.resolve(controller)
                        },
                    }),
                    {
                        status: 202,
                        statusText: 'Accepted',
                        headers: {
                            'content-type': 'text/html',
                            'content-security-policy':
                                "script-src 'nonce-synthetic'; script-src-attr 'none'",
                            'cache-control': 'private, no-store',
                        },
                    },
                ),
            }
        })
        expect(response.context).toEqual({ preserved: true })
        expect(response.response.status).toBe(202)
        expect(response.response.headers.get('cache-control')).toBe(
            'private, no-store',
        )
        expect(
            response.response.headers.get('content-security-policy'),
        ).toContain('nonce-synthetic')
        expect(reserve).toHaveBeenCalledTimes(1)
        const restored = exclusive(async () => true)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        const controller = await produced.promise
        const text = response.response.text()
        controller.enqueue(new TextEncoder().encode('first'))
        controller.enqueue(new TextEncoder().encode('second'))
        controller.close()
        expect(await text).toBe('firstsecond')
        expect(await restored).toBe(true)
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('preserves multiple cookies while forwarding the same body bytes', async function () {
        const headers = new Headers()
        headers.append('set-cookie', 'first=synthetic; HttpOnly')
        headers.append('set-cookie', 'second=synthetic; Secure')
        const response = await protect(async () => ({
            response: new Response('body', { headers }),
        }))
        expect(response.response.headers.getSetCookie()).toEqual(
            headers.getSetCookie(),
        )
        expect(await response.response.text()).toBe('body')
        await drainShared()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('preserves an immutable redirect and unresolved TanStack options', async function () {
        const immutable = Response.redirect('https://example.invalid/next', 303)
        const first = await protect(async () => ({ response: immutable }))
        expect(first.response.status).toBe(immutable.status)
        expect(first.response.headers.get('location')).toBe(
            'https://example.invalid/next',
        )
        expect(await first.response.text()).toBe('')
        const unresolved = redirect({ to: '/login', statusCode: 302 })
        const second = await protect(async () => ({
            response: unresolved,
            metadata: 2,
        }))
        expect(isRedirect(second.response)).toBe(true)
        if (!isRedirect(second.response))
            throw new Error('Missing redirect options.')
        expect(Object.is(second.response.options, unresolved.options)).toBe(
            true,
        )
        expect(second.metadata).toBe(2)
        await second.response.text()
        await drainShared()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('keeps ordinary cancellation successful and runs source cleanup in the existing scope', async function () {
        const cleanupStarted = Promise.withResolvers<void>()
        const cleanupFinished = Promise.withResolvers<void>()
        const response = await protect(async () => ({
            response: new Response(
                new ReadableStream<Uint8Array>({
                    async cancel() {
                        await shared(async function () {
                            cleanupStarted.resolve()
                            await cleanupFinished.promise
                        })
                    },
                }),
            ),
        }))
        if (!response.response.body) throw new Error('Missing body.')
        const restored = exclusive(async () => 1)
        await waitFor(exclusivePublished)
        const canceled = response.response.body.cancel('synthetic cancellation')
        await cleanupStarted.promise
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        cleanupFinished.resolve()
        await canceled
        expect(await restored).toBe(1)
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('drains a pending source read and cancel cleanup before an abort releases storage', async function () {
        const aborted = new AbortController()
        const cleanupStarted = Promise.withResolvers<void>()
        const cleanupFinished = Promise.withResolvers<void>()
        const response = await protect(
            async () => ({
                response: new Response(
                    new ReadableStream<Uint8Array>({
                        async cancel() {
                            await shared(async function () {
                                cleanupStarted.resolve()
                                await cleanupFinished.promise
                            })
                        },
                    }),
                ),
            }),
            { signal: aborted.signal },
        )
        const reader = response.response.body?.getReader()
        if (!reader) throw new Error('Missing reader.')
        const reading = reader.read().catch((error: unknown) => error)
        const restored = exclusive(async () => 2)
        await waitFor(exclusivePublished)
        const reason = new Error('Synthetic abort.')
        aborted.abort(reason)
        await cleanupStarted.promise
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        cleanupFinished.resolve()
        expect(await reading).toBe(reason)
        expect(await restored).toBe(2)
        expect(markUnhealthy).not.toHaveBeenCalled()
        reader.releaseLock()
    })

    it('does not mistake source EOF for completion of registered producer work', async function () {
        const producerStarted = Promise.withResolvers<void>()
        const producerFinished = Promise.withResolvers<void>()
        const response = await protect(async () => ({
            response: new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        void shared(async function () {
                            producerStarted.resolve()
                            await producerFinished.promise
                        })
                        controller.enqueue(new TextEncoder().encode('complete'))
                        controller.close()
                    },
                }),
            ),
        }))
        await producerStarted.promise
        let delivered = false
        const reading = response.response.text().then((value) => {
            delivered = true
            return value
        })
        const restored = exclusive(async () => 3)
        await waitFor(exclusivePublished)
        expect(delivered).toBe(false)
        expect(reserve).toHaveBeenCalledTimes(1)
        producerFinished.resolve()
        expect(await reading).toBe('complete')
        expect(await restored).toBe(3)
    })

    it('retains ownership when an active source cancellation cannot confirm cleanup', async function () {
        const failure = new Error('Synthetic cleanup failure.')
        const response = await protect(async () => ({
            response: new Response(
                new ReadableStream<Uint8Array>({
                    cancel() {
                        throw failure
                    },
                }),
            ),
        }))
        if (!response.response.body) throw new Error('Missing body.')
        await expect(response.response.body.cancel()).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
    })

    it('propagates a terminal source error without treating its stored-error cancellation as a new cleanup failure', async function () {
        const failure = new Error('Synthetic source failure.')
        const response = await protect(async () => ({
            response: new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.error(failure)
                    },
                }),
            ),
        }))
        const responseError = await response.response
            .text()
            .catch((error: unknown) => error)
        expect(responseError).toBe(failure)
        expect(markUnhealthy).not.toHaveBeenCalled()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('does not execute an already aborted request callback', async function () {
        const signal = new AbortController()
        const failure = new Error('Synthetic prior abort.')
        signal.abort(failure)
        const operation = vi.fn(async () => ({
            response: new Response('unused'),
        }))
        await expect(
            protect(operation, { signal: signal.signal }),
        ).rejects.toBe(failure)
        expect(operation).not.toHaveBeenCalled()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('holds a callback that is still pending when its request aborts', async function () {
        const signal = new AbortController()
        const started = Promise.withResolvers<void>()
        const callbackFinished = Promise.withResolvers<void>()
        const failure = new Error('Synthetic pending abort.')
        const response = protect(
            async function () {
                started.resolve()
                await callbackFinished.promise
                return { response: new Response('late') }
            },
            { signal: signal.signal },
        ).catch((error: unknown) => error)
        await started.promise
        signal.abort(failure)
        const restored = exclusive(async () => 4)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        callbackFinished.resolve()
        expect(await response).toBe(failure)
        expect(await restored).toBe(4)
    })

    it('keeps bounded source buffering for a slow consumer', async function () {
        let pulls = 0
        const response = await protect(async () => ({
            response: new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        pulls += 1
                        controller.enqueue(new Uint8Array(16))
                    },
                }),
            ),
        }))
        await waitFor(() => pulls > 0)
        expect(pulls).toBeLessThanOrEqual(3)
        await response.response.body?.cancel()
        await drainShared()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })
    it('preserves an abort while an already errored response arrives after the callback', async function () {
        const signal = new AbortController()
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const abortFailure = new Error('Synthetic response abort.')
        const sourceFailure = new Error('Synthetic terminal source.')
        const result = protect(
            async function () {
                started.resolve()
                await finish.promise
                return {
                    response: new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.error(sourceFailure)
                            },
                        }),
                    ),
                }
            },
            { signal: signal.signal },
        ).catch((error: unknown) => error)
        await started.promise
        signal.abort(abortFailure)
        finish.resolve()
        expect(await result).toBe(abortFailure)
        expect(markUnhealthy).not.toHaveBeenCalled()
        expect(
            await readdir(
                path.join(fixture.rootDirectory, config.sharedDirectoryName),
            ),
        ).toEqual([])
        expect(await shared(async () => 41)).toBe(41)
    })

    it('retains the fence when response source ownership is already held elsewhere', async function () {
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.close()
            },
        })
        const original = new Response(source)
        const otherReader = source.getReader()
        try {
            await expect(
                protect(async () => ({
                    response: original,
                })),
            ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
            expect(markUnhealthy).toHaveBeenCalledTimes(1)
            expect(
                await readdir(
                    path.join(
                        fixture.rootDirectory,
                        config.sharedDirectoryName,
                    ),
                ),
            ).toHaveLength(1)
        } finally {
            otherReader.releaseLock()
        }
    })
})
