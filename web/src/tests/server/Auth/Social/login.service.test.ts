import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { SocialIdentity } from '@/lib/Auth/Types/social-auth.types.ts'

const userId = '00000000-0000-4000-8000-000000000001'
const accountId = '00000000-0000-4000-8000-000000000002'
const factorId = '00000000-0000-4000-8000-000000000003'
const identity: SocialIdentity = { provider: 'google', subject: 'stable-subject', email: 'provider@example.test', emailVerified: true }
function makeUser() { return { id: userId, username: 'member', email: 'local@example.test', passwordHash: 'snapshot-password-hash', isActive: true, isDeleted: false, isTwoFactorEnabled: false } }
type User = ReturnType<typeof makeUser>
type JoinRow = { user: User; account: { id: string; userId: string; provider: string; subject: string } }
type Factor = { id: string; userId: string; verified: boolean }
type Challenge = { tokenHash: string; provider: string; payload: unknown }
type Predicate = (row: Record<string, unknown>) => boolean
const schema = {
    users: { id: 'user.id' },
    socialAccounts: { id: 'account.id', userId: 'account.userId', provider: 'account.provider', subject: 'account.subject' },
    twoFactorAuth: { id: 'id', userId: 'userId' },
}
let joined: JoinRow[] = []
let factors: Factor[] = []
let challenge: Challenge | null = null
let cookiePresent = false
let totpAccepted = true
let totpUsed = false
const events: string[] = []

function value(row: Record<string, unknown>, field: string) {
    const [parent, child] = field.split('.')
    return child ? (row[parent!] as Record<string, unknown> | undefined)?.[child] : row[field]
}
const createSession = mock(async (_input: unknown) => { events.push('session'); return { success: true, redirectTo: '/dashboard' } })
const rateLimit = mock(async (_input: unknown) => { events.push('rate-limit') })
const totp = mock(async (_factor: unknown, _code: string) => {
    events.push('totp')
    if (!totpAccepted || totpUsed) return false
    totpUsed = true
    return true
})
const read = mock(async (_token: string, _browser: string, _purpose: string, _provider?: string, consume?: boolean) => {
    const current = challenge
    if (consume) { events.push('consume'); challenge = null }
    return current
})
const handoff = mock(async (_name: string, provider: string, _purpose: string, payload: unknown, _duration: number) => {
    challenge = { tokenHash: 'challenge-hash', provider, payload }
    cookiePresent = true
})

mock.module('@/db', () => ({ db: { select: () => ({ from: (table: unknown) => ({
    innerJoin: (_joinedTable: unknown, condition: Predicate) => ({ where: (predicate: Predicate) => ({ limit: async (count: number) => joined.filter((row) => condition(row) && predicate(row)).slice(0, count) }) }),
    where: (predicate: Predicate) => ({ limit: async (count: number) => {
        if (table !== schema.twoFactorAuth) throw new Error('Unexpected table')
        return factors.filter(predicate).slice(0, count)
    } }),
}) }) } }))
mock.module('@/db/schema.ts', () => ({ users: schema.users, twoFactorAuth: schema.twoFactorAuth }))
mock.module('@/db/Schema/socialAuth.ts', () => ({ socialAccounts: schema.socialAccounts }))
mock.module('drizzle-orm', () => ({
    eq: (field: string, expected: unknown): Predicate => (row) => value(row, field) === (typeof expected === 'string' && expected.includes('.') ? value(row, expected) : expected),
    and: (...conditions: Predicate[]): Predicate => (row) => conditions.every((condition) => condition(row)),
}))
mock.module('@tanstack/react-start/server', () => ({ deleteCookie: () => { events.push('delete-cookie'); cookiePresent = false } }))
mock.module('@/server/RateLimit/rateLimit.service.ts', () => ({ enforceRateLimit: rateLimit }))
mock.module('@/server/Auth/totp-verification.service.ts', () => ({ consumeTotpCodeService: totp }))
mock.module('@/server/Auth/Login/session.service.ts', () => ({ createAuthenticatedSessionForUser: createSession }))
mock.module('@/server/Auth/Social/challenge.service.ts', () => ({
    createSocialHandoffService: handoff,
    getSocialHandoffCookieService: () => cookiePresent ? { token: 'cookie-token', browserToken: 'browser-token' } : null,
    readSocialChallengeService: read,
}))

const { finishSocialLoginService, signInSocialIdentityService } = await import('@/server/Auth/Social/login.service.ts')

beforeEach(() => {
    joined = [{ user: makeUser(), account: { id: accountId, userId, provider: identity.provider, subject: identity.subject } }]
    factors = []
    challenge = null
    cookiePresent = false
    totpAccepted = true
    totpUsed = false
    events.length = 0
    for (const operation of [createSession, rateLimit, totp, read, handoff]) operation.mockClear()
    createSession.mockImplementation(async () => { events.push('session'); return { success: true, redirectTo: '/dashboard' } })
})

describe('Social login and second-factor completion', () => {
    it('authenticates the provider subject instead of merging a different provider identity by email', async () => {
        expect(await signInSocialIdentityService({ ...identity, subject: 'other-subject', email: joined[0]!.user.email })).toEqual({ kind: 'registration' })
        expect(await signInSocialIdentityService({ ...identity, provider: 'github' })).toEqual({ kind: 'registration' })
        expect(createSession).not.toHaveBeenCalled()
        expect(handoff).not.toHaveBeenCalled()
    })

    it('creates a social session with an explicit no-factor proof for an active account without 2FA', async () => {
        expect(await signInSocialIdentityService(identity)).toEqual({ kind: 'success', redirectTo: '/dashboard' })
        expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ user: joined[0]!.user, proof: { kind: 'social', accountId, factorId: null } }))
        expect(handoff).not.toHaveBeenCalled()
    })

    it.each(['isActive', 'isDeleted'] as const)('refuses disabled or deleted users: %s', async (field) => {
        joined[0]!.user[field] = field === 'isDeleted'
        expect(await signInSocialIdentityService(identity)).toEqual({ kind: 'error', code: 'inactive' })
        expect(createSession).not.toHaveBeenCalled()
        expect(handoff).not.toHaveBeenCalled()
    })

    it.each([true, false])('fails closed for inconsistent enabled/verified second-factor state: enabled=%s', async (enabled) => {
        joined[0]!.user.isTwoFactorEnabled = enabled
        factors = [{ id: factorId, userId, verified: !enabled }]
        expect(await signInSocialIdentityService(identity)).toEqual({ kind: 'error', code: 'failed' })
        expect(createSession).not.toHaveBeenCalled()
        expect(handoff).not.toHaveBeenCalled()
    })

    it('requires a one-time TOTP challenge before issuing a session and binds final proof to the snapshotted factor/account', async () => {
        joined[0]!.user.isTwoFactorEnabled = true
        factors = [{ id: factorId, userId, verified: true }]
        expect(await signInSocialIdentityService(identity)).toEqual({ kind: 'two_factor' })
        expect(createSession).not.toHaveBeenCalled()
        expect(handoff).toHaveBeenCalledWith('marketplace_social_login', 'google', 'two_factor', { accountId, factorId, user: joined[0]!.user }, expect.any(Number))
        expect(await finishSocialLoginService('123456')).toEqual({ success: true, redirectTo: '/dashboard' })
        expect(rateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'social-two-factor-challenge', identifiers: ['challenge-hash'], includeClientIp: false }))
        expect(totp).toHaveBeenCalledWith(factors[0], '123456')
        expect(events).toEqual(['rate-limit', 'totp', 'consume', 'delete-cookie', 'session'])
        expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ proof: { kind: 'social', accountId, factorId } }))
        expect((await finishSocialLoginService('123456')).success).toBe(false)
        expect(createSession).toHaveBeenCalledTimes(1)
        expect(totp).toHaveBeenCalledTimes(1)
    })

    it('retains a live challenge after a wrong TOTP without authenticating the account', async () => {
        joined[0]!.user.isTwoFactorEnabled = true
        factors = [{ id: factorId, userId, verified: true }]
        await signInSocialIdentityService(identity)
        totpAccepted = false
        expect((await finishSocialLoginService('000000')).success).toBe(false)
        expect(challenge).not.toBeNull()
        expect(cookiePresent).toBe(true)
        expect(createSession).not.toHaveBeenCalled()
        totpAccepted = true
        expect((await finishSocialLoginService('123456')).success).toBe(true)
    })

    it('rejects a replaced factor instead of verifying a challenge against a new factor', async () => {
        joined[0]!.user.isTwoFactorEnabled = true
        factors = [{ id: factorId, userId, verified: true }]
        await signInSocialIdentityService(identity)
        factors = [{ id: '00000000-0000-4000-8000-000000000004', userId, verified: true }]
        expect((await finishSocialLoginService('123456')).success).toBe(false)
        expect(totp).not.toHaveBeenCalled()
        expect(createSession).not.toHaveBeenCalled()
    })

    it('cannot issue two sessions when the same challenge is completed concurrently', async () => {
        joined[0]!.user.isTwoFactorEnabled = true
        factors = [{ id: factorId, userId, verified: true }]
        await signInSocialIdentityService(identity)
        const results = await Promise.all([finishSocialLoginService('123456'), finishSocialLoginService('123456')])
        expect(results.filter((result) => result.success)).toHaveLength(1)
        expect(createSession).toHaveBeenCalledTimes(1)
    })

    it('applies the challenge rate limit before checking TOTP or issuing a session', async () => {
        joined[0]!.user.isTwoFactorEnabled = true
        factors = [{ id: factorId, userId, verified: true }]
        await signInSocialIdentityService(identity)
        rateLimit.mockRejectedValueOnce(new Error('Rate limited'))
        await expect(finishSocialLoginService('123456')).rejects.toThrow('Rate limited')
        expect(totp).not.toHaveBeenCalled()
        expect(createSession).not.toHaveBeenCalled()
        expect(challenge).not.toBeNull()
    })
})
