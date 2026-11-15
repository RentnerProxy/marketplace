import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    setSystemTime,
} from 'bun:test'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { createPasswordResetTokenService } from '@/server/Auth/PasswordReset/token.service.ts'

vi.mock('@/config/session.config.ts', function () {
    return {
        passwordResetConfig: {
            durationMs: 60_000,
        },
    }
})

vi.mock('@/lib/Auth/tokens.ts', function () {
    return {
        createTokenHash: vi.fn(async function (token: string) {
            return `hash:${token}`
        }),
    }
})

describe('Password-Reset-Token-Erzeugung', function () {
    beforeEach(function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
    })

    afterEach(function () {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    it('liefert Roh-Token, Hash und die konfigurierte Ablaufzeit', async function () {
        const result = await createPasswordResetTokenService()

        expect(result.token).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
        expect(createTokenHash).toHaveBeenCalledWith(result.token)
        expect(result).toEqual({
            token: result.token,
            tokenHash: `hash:${result.token}`,
            expiresAt: new Date('2026-07-14T12:01:00.000Z'),
        })
    })
})
