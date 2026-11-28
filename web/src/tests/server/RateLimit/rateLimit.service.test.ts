import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { getClientIp } from '@/lib/Request/clientRequestMeta.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { mockValkeyDefineCommand } from '@/tests/shared/valkey-script.test.helpers.ts'

const rateLimitMocks = (function () {
    const evalScript = vi.fn(async function (
        ..._arguments: Array<unknown>
    ): Promise<unknown> {
        return [1, 60_000]
    })
    return {
        getClientIp: vi.fn(function () {
            return '203.0.113.10'
        }),
        valkey: {
            eval: evalScript,
            defineCommand: mockValkeyDefineCommand(evalScript),
        },
    }
})()

vi.mock('@/lib/Request/clientRequestMeta.ts', function () {
    return { getClientIp: rateLimitMocks.getClientIp }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: vi.fn(function () {
            return rateLimitMocks.valkey
        }),
    }
})

const mockedGetClientIp = getClientIp as Mock<typeof getClientIp>
const mockedGetValkeyConnection = getValkeyConnection as Mock<
    typeof getValkeyConnection
>

describe('Rate-Limit-Service', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        rateLimitMocks.getClientIp.mockReset().mockReturnValue('203.0.113.10')
        rateLimitMocks.valkey.eval.mockReset().mockResolvedValue([1, 60_000])
    })

    it('kann ein Account-Limit unabhängig von der Client-IP bilden', async function () {
        mockedGetClientIp
            .mockReturnValueOnce('203.0.113.10')
            .mockReturnValueOnce('203.0.113.11')

        await enforceRateLimit({
            scope: 'account',
            identifiers: ['kevin@example.test'],
            includeClientIp: false,
            limit: 5,
            windowMs: 60_000,
        })
        await enforceRateLimit({
            scope: 'account',
            identifiers: ['kevin@example.test'],
            includeClientIp: false,
            limit: 5,
            windowMs: 60_000,
        })

        const firstKey = rateLimitMocks.valkey.eval.mock.calls[0]?.[2]
        const secondKey = rateLimitMocks.valkey.eval.mock.calls[1]?.[2]

        expect(firstKey).toBe(secondKey)
        expect(mockedGetClientIp).not.toHaveBeenCalled()
        expect(mockedGetValkeyConnection).toHaveBeenCalledTimes(2)
    })

    it('bildet ohne Account-Identifier ein echtes globales IP-Budget', async function () {
        await enforceRateLimit({
            scope: 'login-ip',
            limit: 50,
            windowMs: 900_000,
        })
        await enforceRateLimit({
            scope: 'login-ip',
            limit: 50,
            windowMs: 900_000,
        })
        rateLimitMocks.getClientIp.mockReturnValue('203.0.113.11')
        await enforceRateLimit({
            scope: 'login-ip',
            limit: 50,
            windowMs: 900_000,
        })
        const keys = rateLimitMocks.valkey.eval.mock.calls.map(function (call) {
            return call[2]
        })
        expect(keys[0]).toBe(keys[1])
        expect(keys[0]).not.toBe(keys[2])
        expect(keys[0]).not.toContain('203.0.113.10')
        expect(mockedGetClientIp).toHaveBeenCalledTimes(3)
    })

    it('lässt den Grenzwert zu und rundet die Rest-TTL beim ersten Überschreiten auf', async function () {
        rateLimitMocks.valkey.eval.mockResolvedValueOnce([5, 60_000])
        rateLimitMocks.valkey.eval.mockResolvedValueOnce([6, 499])
        const options = { scope: 'limited', limit: 5, windowMs: 60_000 }
        await expect(enforceRateLimit(options)).resolves.toBeUndefined()
        await expect(enforceRateLimit(options)).rejects.toMatchObject({
            name: 'RateLimitError',
            retryAfterSeconds: 1,
        })
        expect(rateLimitMocks.valkey.eval.mock.calls[0]?.[1]).toBe(1)
        expect(rateLimitMocks.valkey.eval.mock.calls[0]?.[3]).toBe('60000')
    })

    it('trennt die Budgets unterschiedlicher Scopes mit derselben Identität', async function () {
        await enforceRateLimit({
            scope: 'login-ip',
            limit: 50,
            windowMs: 900_000,
        })
        await enforceRateLimit({
            scope: 'reset-ip',
            limit: 20,
            windowMs: 900_000,
        })
        expect(rateLimitMocks.valkey.eval.mock.calls[0]?.[2]).not.toBe(
            rateLimitMocks.valkey.eval.mock.calls[1]?.[2],
        )
    })

    it('propagiert Valkey-Ausfälle statt einen Limit-Check als erfolgreich zu behandeln', async function () {
        rateLimitMocks.valkey.eval.mockRejectedValueOnce(
            new Error('synthetic Valkey failure'),
        )
        await expect(
            enforceRateLimit({
                scope: 'login-ip',
                limit: 50,
                windowMs: 900_000,
            }),
        ).rejects.toThrow('synthetic Valkey failure')
    })

    it.each(
        [
            null,
            undefined,
            [],
            ['1', 60_000],
            [1, '60000'],
            [0, 60_000],
            [-1, 60_000],
            [1.5, 60_000],
            [Number.NaN, 60_000],
            [Number.POSITIVE_INFINITY, 60_000],
            [1, Number.NaN],
            [1, Number.POSITIVE_INFINITY],
        ].map((value) => ({ value })),
    )(
        'lehnt einen beschädigten Limit-Zustand ab: %j',
        async function ({ value }) {
            rateLimitMocks.valkey.eval.mockResolvedValueOnce(value)
            await expect(
                enforceRateLimit({
                    scope: 'invalid-result',
                    limit: 5,
                    windowMs: 60_000,
                }),
            ).rejects.toThrow()
        },
    )

    it('sperrt auch ohne verbleibende TTL bei überschrittenem Budget', async function () {
        rateLimitMocks.valkey.eval.mockResolvedValueOnce([6, -1])
        await expect(
            enforceRateLimit({
                scope: 'missing-ttl',
                limit: 5,
                windowMs: 60_000,
            }),
        ).rejects.toMatchObject({
            name: 'RateLimitError',
            retryAfterSeconds: 1,
        })
    })
})
