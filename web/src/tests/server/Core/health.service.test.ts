import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    getCoreRuntimeHealthService as health,
    getCoreRuntimeOriginService as origin,
} from '@/server/Core/health.service.ts'

const originalOrigin = process.env.CORE_ORIGIN
const fetcher = vi.spyOn(globalThis, 'fetch')
const runtime = {
    status: 'running' as const,
    version: '0.1.0',
    pid: 123,
    uptimeSeconds: 42,
}
beforeEach(() => {
    delete process.env.CORE_ORIGIN
    fetcher.mockClear()
})
afterEach(() => {
    if (originalOrigin === undefined) delete process.env.CORE_ORIGIN
    else process.env.CORE_ORIGIN = originalOrigin
})

describe('Rust-Core-Überwachung', () => {
    it('akzeptiert die vollständige native Versionsgrenze von 128 Zeichen', async () => {
        fetcher.mockResolvedValueOnce(
            Response.json({ ...runtime, version: 'v'.repeat(128) }),
        )
        expect((await health()).version).toHaveLength(128)
        fetcher.mockResolvedValueOnce(
            Response.json({ ...runtime, version: 'v'.repeat(129) }),
        )
        await expect(health()).rejects.toThrow()
    })
    it('fragt nur die lokale Statusschnittstelle ohne Cache oder Weiterleitung ab', async () => {
        fetcher.mockResolvedValueOnce(Response.json(runtime))
        expect(await health()).toEqual(runtime)
        const call = fetcher.mock.calls[0]!
        expect(String(call[0])).toBe('http://127.0.0.1:3004/core/health')
        expect(call[1]).toMatchObject({ cache: 'no-store', redirect: 'error' })
        expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
    })

    it.each(['http://localhost:3004', 'http://[::1]:3004'])(
        'erlaubt die explizite Loopback-Origin %s',
        (value) => {
            process.env.CORE_ORIGIN = value
            expect(origin()).toBe(value)
        },
    )

    it.each([
        'https://localhost:3004',
        'http://example.com',
        'http://user:password@localhost',
        'http://localhost/path',
        'http://localhost?query',
        'http://localhost#fragment',
    ])(
        'verweigert die ungültige Origin %s vor einem Zugriff',
        async (value) => {
            process.env.CORE_ORIGIN = value
            await expect(health()).rejects.toThrow()
            expect(fetcher).not.toHaveBeenCalled()
        },
    )

    it.each([
        () => new Response('', { status: 503 }),
        () => new Response(null),
        () => new Response('invalid json'),
        () => Response.json({ ...runtime, status: 'healthy' }),
        () => Response.json({ ...runtime, pid: 0 }),
        () => Response.json({ ...runtime, uptimeSeconds: -1 }),
        () => Response.json({ ...runtime, extra: 'untrusted' }),
        () => new Response('{}', { headers: { 'content-length': '4097' } }),
        () => new Response('x'.repeat(4097)),
    ])(
        'meldet ungültige, fehlende und zu große Antworten als ausgefallene Statusabfrage',
        async (response) => {
            fetcher.mockResolvedValueOnce(response())
            await expect(health()).rejects.toThrow()
        },
    )

    it('begrenzt gestückelte Antworten nach tatsächlichen Bytes und beendet den Stream', async () => {
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(2048))
                controller.enqueue(new Uint8Array(2049))
            },
            cancel() {
                cancelled = true
            },
        })
        fetcher.mockResolvedValueOnce(new Response(stream))
        await expect(health()).rejects.toThrow('too large')
        expect(cancelled).toBe(true)
        expect(stream.locked).toBe(false)
    })
})
