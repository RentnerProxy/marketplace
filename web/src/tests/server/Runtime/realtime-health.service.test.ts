import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    getRealtimeHealthUrlService as url,
    probeRealtimeHealthService as probe,
} from '@/server/Runtime/realtime-health.service.ts'

const keys = [
    'NODE_ENV',
    'REALTIME_PUBLISH_URL',
    'REALTIME_WS_PORT',
    'REALTIME_WS_HOST',
    'PORT',
    'INTERNAL_PROXY_SECRET',
] as const
const original = new Map(keys.map((key) => [key, process.env[key]]))
const fetcher = vi.spyOn(globalThis, 'fetch')
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    fetcher.mockReset()
})
afterAll(() => {
    for (const [key, value] of original) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    fetcher.mockRestore()
})

describe('Lokale WebSocket-Statusprüfung', () => {
    it('verwendet den Entwicklungslistener und seine konfigurierten Ports', () => {
        expect(url().href).toBe('http://127.0.0.1:3001/ws')
        process.env.REALTIME_WS_HOST = '::1'
        process.env.REALTIME_WS_PORT = '4333'
        expect(url().href).toBe('http://[::1]:4333/ws')
    })

    it('prüft in Produktion den äußeren Listener trotz abweichendem internem App-Port', () => {
        process.env.NODE_ENV = 'production'
        process.env.PORT = '3002'
        process.env.REALTIME_PUBLISH_URL =
            'http://127.0.0.1:4000/__internal/realtime/publish'
        expect(url().href).toBe('http://127.0.0.1:4000/ws')
        delete process.env.REALTIME_PUBLISH_URL
        expect(url().href).toBe('http://127.0.0.1:3002/ws')
        delete process.env.PORT
        expect(url().href).toBe('http://127.0.0.1:3000/ws')
    })

    it.each([
        'http://remote.example/ws',
        'https://localhost',
        'http://user:secret@127.0.0.1',
        'http://localhost?query',
        'http://localhost#fragment',
    ])(
        'sendet keine privaten Probe-Header an eine ungültige Origin (%s)',
        async (value) => {
            process.env.NODE_ENV = 'production'
            process.env.REALTIME_PUBLISH_URL = value
            process.env.INTERNAL_PROXY_SECRET = 'synthetic-secret'
            await expect(probe(new AbortController().signal)).rejects.toThrow()
            expect(fetcher).not.toHaveBeenCalled()
        },
    )

    it.each(['0', '65536', 'invalid'])(
        'weist ungültige Ports vor einem Netzwerkzugriff zurück (%s)',
        (value) => {
            process.env.NODE_ENV = 'production'
            process.env.PORT = value
            expect(url).toThrow()
        },
    )

    it('erkennt ausschließlich die echte Upgrade-Antwort und folgt keinen Weiterleitungen', async () => {
        process.env.NODE_ENV = 'production'
        process.env.INTERNAL_PROXY_SECRET = 'synthetic-secret'
        const signal = new AbortController().signal
        fetcher.mockResolvedValueOnce(
            new Response('WebSocket upgrade required', { status: 426 }),
        )
        expect(await probe(signal)).toBe(true)
        expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            signal,
            headers: { 'x-realtime-health-secret': 'synthetic-secret' },
        })
        fetcher.mockResolvedValueOnce(new Response('ordinary HTTP page'))
        expect(await probe(signal)).toBe(false)
        fetcher.mockRejectedValueOnce(new Error('network unavailable'))
        await expect(probe(signal)).rejects.toThrow('network unavailable')
    })
})
