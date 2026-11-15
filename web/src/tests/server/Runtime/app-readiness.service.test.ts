import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { APP_READINESS } from '@/config/health.config.ts'
import { createAppReadinessCheckService } from '@/server/Runtime/app-readiness.service.ts'

let previousValkeyUrl: string | undefined
beforeEach(function () {
    previousValkeyUrl = process.env.VALKEY_URL
    process.env.VALKEY_URL = 'redis://127.0.0.1:9/0'
})
afterEach(function () {
    vi.restoreAllMocks()
    if (previousValkeyUrl === undefined) delete process.env.VALKEY_URL
    else process.env.VALKEY_URL = previousValkeyUrl
})

describe('Web app readiness independent of Valkey', function () {
    it('checks the internal web app with HEAD despite a configured offline Valkey', async function () {
        const request = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 200 }))
        await expect(createAppReadinessCheckService(3002)()).resolves.toBe(true)
        expect(request).toHaveBeenCalledWith(
            'http://127.0.0.1:3002/api/system/restore-status',
            { method: 'HEAD', signal: expect.any(AbortSignal) },
        )
    })

    it.each([307, 404, 503])(
        'keeps the readiness check unhealthy for an unavailable internal app (%s)',
        async function (status) {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(null, { status }),
            )
            await expect(createAppReadinessCheckService(3002)()).resolves.toBe(
                false,
            )
        },
    )

    it('handles an unreachable internal app and recovers after the cache expires', async function () {
        let now = 1_000
        vi.spyOn(Date, 'now').mockImplementation(() => now)
        const request = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(new Response(null, { status: 200 }))
        const isReady = createAppReadinessCheckService(3002)
        await expect(isReady()).resolves.toBe(false)
        await expect(isReady()).resolves.toBe(false)
        expect(request).toHaveBeenCalledTimes(1)
        now += APP_READINESS.cacheMs
        await expect(isReady()).resolves.toBe(true)
        expect(request).toHaveBeenCalledTimes(2)
    })

    it('shares a pending request and caches its result for repeated healthchecks', async function () {
        let now = 1_000
        vi.spyOn(Date, 'now').mockImplementation(() => now)
        const gate = Promise.withResolvers<Response>()
        const request = vi
            .spyOn(globalThis, 'fetch')
            .mockReturnValue(gate.promise)
        const isReady = createAppReadinessCheckService(3002)
        const first = isReady()
        const second = isReady()
        expect(request).toHaveBeenCalledTimes(1)
        gate.resolve(new Response(null, { status: 200 }))
        await expect(Promise.all([first, second])).resolves.toEqual([
            true,
            true,
        ])
        await expect(isReady()).resolves.toBe(true)
        expect(request).toHaveBeenCalledTimes(1)
        now += APP_READINESS.cacheMs
        await expect(isReady()).resolves.toBe(true)
        expect(request).toHaveBeenCalledTimes(2)
    })
})
