import { beforeEach, describe, expect, it, mock } from 'bun:test'

const events: string[] = []
const rateLimit = mock(async (_input: unknown) => { events.push('rate-limit') })
const begin = mock(async (_provider: string) => { events.push('begin'); return { url: 'https://provider.example.test/authorize' } })
const finish = mock(async (_code: string) => { events.push('finish'); return { success: true, redirectTo: '/dashboard' } })
const cancel = mock(async () => ({ success: true }))
const registration = mock(async (): Promise<{ provider: 'google'; email: string; emailVerified: boolean; subject: string; requestId: string } | null> => ({ provider: 'google', email: 'member@example.test', emailVerified: true, subject: 'private-provider-subject', requestId: 'private-challenge-hash' }))
const challenge = mock(async (): Promise<{ payload: unknown; tokenHash: string } | null> => ({ payload: { passwordHash: 'private-password-hash' }, tokenHash: 'private-token-hash' }))

mock.module('@tanstack/react-start', () => ({ createServerFn: () => ({
    handler: (handler: () => Promise<unknown>) => handler,
    validator: (validate: (input: unknown) => unknown) => ({ handler: (handler: (input: { data: unknown }) => Promise<unknown>) => async (input: { data: unknown }) => handler({ data: validate(input.data) }) }),
}) }))
mock.module('@/server/RateLimit/rateLimit.service.ts', () => ({ enforceRateLimit: rateLimit }))
mock.module('@/server/Auth/Social/flow.service.ts', () => ({ beginSocialAuthorizationService: begin, cancelSocialAuthService: cancel }))
mock.module('@/server/Auth/Social/config.service.ts', () => ({ getConfiguredSocialProvidersService: () => [{ id: 'google', name: 'Google' }] }))
mock.module('@/server/Auth/Social/registration.service.ts', () => ({ getSocialRegistrationIdentityService: registration }))
mock.module('@/server/Auth/Social/login.service.ts', () => ({ finishSocialLoginService: finish, getSocialLoginChallengeService: challenge }))

const { beginSocialLoginHandler, cancelSocialAuthHandler, finishSocialLoginHandler, getSocialAuthStateHandler } = await import('@/features/Auth/Social/middleware.ts')

beforeEach(() => {
    events.length = 0
    for (const operation of [rateLimit, begin, finish, cancel, registration, challenge]) operation.mockClear()
})

describe('Public social authentication boundaries', () => {
    it('returns public registration hints and 2FA state without returning subjects, challenge hashes or credential snapshots', async () => {
        expect(await getSocialAuthStateHandler()).toEqual({ providers: [{ id: 'google', name: 'Google' }], registration: { provider: 'google', email: 'member@example.test', emailVerified: true }, requiresTwoFactor: true })
        registration.mockResolvedValueOnce(null)
        challenge.mockResolvedValueOnce(null)
        expect(await getSocialAuthStateHandler()).toEqual({ providers: [{ id: 'google', name: 'Google' }], registration: null, requiresTwoFactor: false })
    })

    it('rate-limits provider starts before delegating the validated provider', async () => {
        expect(await beginSocialLoginHandler({ data: { provider: 'google' } })).toEqual({ url: 'https://provider.example.test/authorize' })
        expect(events).toEqual(['rate-limit', 'begin'])
        expect(rateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'social-start-ip' }))
        expect(begin).toHaveBeenCalledWith('google')
    })

    it.each(['unknown', 'apple', 'facebook', 'microsoft'])('rejects unsupported provider %s before rate limiting or starting authorization', async (provider) => {
        await expect(beginSocialLoginHandler({ data: { provider, reauthentication: { method: 'password', credential: 'test-password' } } as never })).rejects.toThrow()
        expect(rateLimit).not.toHaveBeenCalled()
        expect(begin).not.toHaveBeenCalled()
    })

    it('rate-limits second-factor completion before passing the validated six-digit code', async () => {
        expect(await finishSocialLoginHandler({ data: { twoFactorCode: '123456' } })).toEqual({ success: true, redirectTo: '/dashboard' })
        expect(events).toEqual(['rate-limit', 'finish'])
        expect(rateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'social-two-factor-ip' }))
        expect(finish).toHaveBeenCalledWith('123456')
    })

    it.each(['12345', '1234567', 'abcdef'])('rejects malformed second factors before delegation: %s', async (twoFactorCode) => {
        await expect(finishSocialLoginHandler({ data: { twoFactorCode } })).rejects.toThrow()
        expect(rateLimit).not.toHaveBeenCalled()
        expect(finish).not.toHaveBeenCalled()
    })

    it('does not start or finish authentication after rate limiting fails', async () => {
        rateLimit.mockRejectedValueOnce(new Error('Rate limited'))
        await expect(beginSocialLoginHandler({ data: { provider: 'github' } })).rejects.toThrow('Rate limited')
        rateLimit.mockRejectedValueOnce(new Error('Rate limited'))
        await expect(finishSocialLoginHandler({ data: { twoFactorCode: '123456' } })).rejects.toThrow('Rate limited')
        expect(begin).not.toHaveBeenCalled()
        expect(finish).not.toHaveBeenCalled()
    })

    it('delegates cancellation to durable handoff cleanup', async () => {
        expect(await cancelSocialAuthHandler()).toEqual({ success: true })
        expect(cancel).toHaveBeenCalledTimes(1)
    })
})
