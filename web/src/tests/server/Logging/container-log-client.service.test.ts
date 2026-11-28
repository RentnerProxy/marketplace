import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { CONTAINER_LOGS } from '@/config/logging.config.ts'
import type { RuntimeLogSnapshot } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import {
    getContainerLogReaderOriginService,
    getContainerLogsService,
} from '@/server/Logging/container-log-client.service.ts'

const originalOrigin = process.env.CONTAINER_LOG_READER_URL
const preconnect = globalThis.fetch.preconnect
const fetcher = vi.spyOn(globalThis, 'fetch')
const timeoutSignal = AbortSignal.timeout.bind(AbortSignal)
const reader = 'http://127.0.0.1:3004'
const snapshot = {
    source: 'container',
    sharedHistoryAvailable: true,
    entries: [
        {
            id: 'a'.repeat(64),
            timestamp: '2026-01-01T00:00:00.000Z',
            level: 'info',
            event: 'container.stdout',
            context: {},
            message: 'Synthetic log entry',
        },
    ],
} satisfies RuntimeLogSnapshot

async function waitForRequestAbort(
    ...[, init]: Parameters<typeof fetch>
): Promise<never> {
    const signal = init?.signal
    if (!signal) throw new Error('Expected a request timeout')
    await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    signal.throwIfAborted()
    throw new Error('Expected an aborted request')
}

beforeEach(() => {
    delete process.env.CONTAINER_LOG_READER_URL
    fetcher.mockClear()
})
afterEach(() => {
    if (originalOrigin === undefined)
        delete process.env.CONTAINER_LOG_READER_URL
    else process.env.CONTAINER_LOG_READER_URL = originalOrigin
})

describe('container log loopback reader', () => {
    it('keeps the native reader optional and accepts the appliance setting', () => {
        expect(getContainerLogReaderOriginService()).toBeNull()
        process.env.CONTAINER_LOG_READER_URL = '   '
        expect(getContainerLogReaderOriginService()).toBeNull()
        process.env.CONTAINER_LOG_READER_URL = ' ' + reader + ' '
        expect(getContainerLogReaderOriginService()).toBe(reader)
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('retains loopback HTTPS and keeps hostname checks for TLS', async () => {
        const origin = 'https://localhost:3004'
        process.env.CONTAINER_LOG_READER_URL = origin
        expect(getContainerLogReaderOriginService()).toBe(origin)
        fetcher.mockResolvedValueOnce(Response.json(snapshot))
        expect(await getContainerLogsService(origin, 'core')).toEqual(snapshot)
        expect(String(fetcher.mock.calls[0]?.[0])).toBe(
            'https://127.0.0.1:3004/logs?service=core',
        )
        expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
            headers: { host: 'localhost:3004' },
            tls: { serverName: 'localhost' },
            proxy: false,
            redirect: 'error',
            cache: 'no-store',
        })
    })

    it.each([
        'http://0.0.0.0:3004',
        'http://localhost.example.test',
        'http://169.254.169.254',
        'http://user:password@localhost',
        'http://@localhost',
        'http://127.0.0.1#fragment',
        'http://127.0.0.1/paths',
    ])('rejects unsafe configured and direct origins %s', async (origin) => {
        process.env.CONTAINER_LOG_READER_URL = origin
        expect(() => getContainerLogReaderOriginService()).toThrow()
        await expect(getContainerLogsService(origin, 'worker')).rejects.toThrow(
            'container_logs_unavailable',
        )
        expect(fetcher).not.toHaveBeenCalled()
    })

    it.each([
        () => new Response('', { status: 503 }),
        () => new Response(null),
        () => new Response('invalid JSON'),
        () => Response.json({ ...snapshot, source: 'application' }),
        () =>
            new Response('{}', {
                headers: {
                    'content-length': String(
                        CONTAINER_LOGS.maxResponseBytes + 1,
                    ),
                },
            }),
    ])(
        'maps unusable responses to the existing log error',
        async (response) => {
            fetcher.mockResolvedValueOnce(response())
            await expect(
                getContainerLogsService(reader, 'worker'),
            ).rejects.toThrow('container_logs_unavailable')
        },
    )

    it('cancels a response when actual streamed bytes exceed the bound', async () => {
        const cancel = vi.fn()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new Uint8Array(CONTAINER_LOGS.maxResponseBytes),
                )
                controller.enqueue(new Uint8Array(1))
            },
            cancel,
        })
        fetcher.mockResolvedValueOnce(new Response(stream))
        await expect(getContainerLogsService(reader, 'worker')).rejects.toThrow(
            'container_logs_unavailable',
        )
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(stream.locked).toBe(false)
    })

    it('aborts a stalled headers request at the standard configured timeout', async () => {
        const timeout = vi
            .spyOn(AbortSignal, 'timeout')
            .mockImplementationOnce(() => timeoutSignal(20))
        try {
            fetcher.mockImplementationOnce(
                Object.assign(waitForRequestAbort, { preconnect }),
            )
            await expect(
                getContainerLogsService(reader, 'worker'),
            ).rejects.toThrow('container_logs_unavailable')
            expect(timeout).toHaveBeenCalledWith(
                CONTAINER_LOGS.requestTimeoutMs,
            )
            expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        } finally {
            timeout.mockRestore()
        }
    })

    it('cancels a stalled body at the same deadline without relying on fetch to cancel it', async () => {
        const timeout = vi
            .spyOn(AbortSignal, 'timeout')
            .mockImplementationOnce(() => timeoutSignal(20))
        try {
            const cancel = vi.fn()
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array(1))
                },
                cancel,
            })
            fetcher.mockResolvedValueOnce(new Response(stream))
            await expect(
                getContainerLogsService(reader, 'worker'),
            ).rejects.toThrow('container_logs_unavailable')
            expect(timeout).toHaveBeenCalledWith(
                CONTAINER_LOGS.requestTimeoutMs,
            )
            expect(cancel).toHaveBeenCalledTimes(1)
            expect(stream.locked).toBe(false)
        } finally {
            timeout.mockRestore()
        }
    })
})
