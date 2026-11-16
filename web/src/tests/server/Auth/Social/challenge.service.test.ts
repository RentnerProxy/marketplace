import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { decryptAuthSecret } from '@/lib/Auth/secretEncryption.ts'

type Row = Record<string, unknown> & { tokenHash: string; browserHash: string; provider: string; purpose: string; payload: string; expiresAt: Date }
type Predicate = (row: Row) => boolean
const schema = { tokenHash: 'tokenHash', browserHash: 'browserHash', provider: 'provider', purpose: 'purpose', expiresAt: 'expiresAt' }
let rows: Row[] = []
const cookies = new Map<string, string>()
const setCookie = mock((name: string, value: string, _options: unknown) => { cookies.set(name, value) })
const origin = mock(() => new URL('https://market.example.test'))
const adapter = {
    insert: () => ({ values: async (row: Row) => { rows.push(row) } }),
    select: () => ({ from: () => ({ where: (predicate: Predicate) => ({ limit: async (count: number) => rows.filter(predicate).slice(0, count) }) }) }),
    delete: () => ({ where: (predicate: Predicate) => {
        const removed = rows.filter(predicate)
        rows = rows.filter((row) => !predicate(row))
        return Object.assign(Promise.resolve(), { returning: async () => removed })
    } }),
}

mock.module('@/db', () => ({ db: adapter }))
mock.module('@/db/Schema/socialAuth.ts', () => ({ socialAuthChallenges: schema }))
mock.module('drizzle-orm', () => ({
    eq: (field: string, value: unknown): Predicate => (row) => row[field] === value,
    gt: (field: string, value: Date): Predicate => (row) => row[field] instanceof Date && row[field] > value,
    lte: (field: string, value: Date): Predicate => (row) => row[field] instanceof Date && row[field] <= value,
    and: (...conditions: Predicate[]): Predicate => (row) => conditions.every((condition) => condition(row)),
}))
mock.module('@tanstack/react-start/server', () => ({
    getCookie: (name: string) => cookies.get(name),
    setCookie,
    deleteCookie: (name: string) => { cookies.delete(name) },
}))
mock.module('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: (name: string) => {
        if (name !== 'AUTH_ENCRYPTION_KEY') throw new Error('Unexpected environment access')
        return Buffer.alloc(32, 7).toString('base64')
    },
}))
mock.module('@/server/Auth/Social/config.service.ts', () => ({ getSocialAuthOriginService: origin }))

const { cleanupExpiredSocialChallengesService, clearSocialHandoffService, createSocialHandoffService, createSocialTokenService, getSocialHandoffCookieService, readSocialChallengeService, setSocialCookieService, storeSocialChallengeService } = await import('@/server/Auth/Social/challenge.service.ts')
const state = 's'.repeat(43)
const browser = 'b'.repeat(43)
const payload = { codeVerifier: 'private-pkce-verifier', nonce: 'private-nonce' }

async function store(token = state, browserToken = browser, durationMs = 60_000) {
    return storeSocialChallengeService({ token, browserToken, provider: 'google', purpose: 'authorization', payload, durationMs })
}

beforeEach(() => {
    rows = []
    cookies.clear()
    setCookie.mockClear()
    origin.mockReturnValue(new URL('https://market.example.test'))
})

describe('Durable social authentication challenges', () => {
    it('stores hashed bearer material and an authenticated encrypted payload using the real encryption service', async () => {
        const tokenHash = await store()
        const row = rows[0]!
        expect(tokenHash).toBe(await createTokenHash(state))
        expect(row.browserHash).toBe(await createTokenHash(browser))
        expect(JSON.stringify(row)).not.toContain(state)
        expect(JSON.stringify(row)).not.toContain(browser)
        expect(row.payload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        expect(row.payload).not.toContain(payload.codeVerifier)
        expect(JSON.parse(await decryptAuthSecret(row.payload))).toEqual({ tokenHash, browserHash: row.browserHash, provider: 'google', purpose: 'authorization', payload })
        expect((await readSocialChallengeService(state, browser, 'authorization', 'google'))?.payload).toEqual(payload)
    })

    it('requires matching browser, provider and purpose without consuming a valid challenge on mismatches', async () => {
        await store()
        expect(await readSocialChallengeService(state, 'x'.repeat(43), 'authorization', 'google', true)).toBeNull()
        expect(await readSocialChallengeService(state, browser, 'authorization', 'github', true)).toBeNull()
        expect(await readSocialChallengeService(state, browser, 'registration', 'google', true)).toBeNull()
        expect(await readSocialChallengeService('invalid', browser, 'authorization', 'google', true)).toBeNull()
        expect(rows).toHaveLength(1)
        expect(await readSocialChallengeService(state, browser, 'authorization', 'google', true)).not.toBeNull()
    })

    it('atomically consumes a challenge so concurrent completions and later replays cannot both succeed', async () => {
        await store()
        const results = await Promise.all([
            readSocialChallengeService(state, browser, 'authorization', 'google', true),
            readSocialChallengeService(state, browser, 'authorization', 'google', true),
        ])
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(rows).toHaveLength(0)
        expect(await readSocialChallengeService(state, browser, 'authorization', 'google', true)).toBeNull()
    })

    it('refuses expired state and prunes it while preserving live challenges', async () => {
        await store(state, browser, -1)
        await store('l'.repeat(43))
        expect(await readSocialChallengeService(state, browser, 'authorization', 'google', true)).toBeNull()
        await cleanupExpiredSocialChallengesService()
        expect(rows).toHaveLength(1)
        expect(rows[0]?.tokenHash).toBe(await createTokenHash('l'.repeat(43)))
    })

    it('rejects encrypted payloads transplanted onto another valid database identity', async () => {
        await store()
        await store('t'.repeat(43), 'c'.repeat(43))
        rows[1]!.payload = rows[0]!.payload
        expect(await readSocialChallengeService('t'.repeat(43), 'c'.repeat(43), 'authorization', 'google', true)).toBeNull()
    })

    it('replaces a previous handoff and cancels its durable challenge explicitly', async () => {
        await createSocialHandoffService('handoff', 'google', 'registration', payload, 60_000)
        const first = getSocialHandoffCookieService('handoff')!
        await createSocialHandoffService('handoff', 'google', 'registration', payload, 60_000)
        expect(rows).toHaveLength(1)
        expect(await readSocialChallengeService(first.token, first.browserToken, 'registration')).toBeNull()
        await clearSocialHandoffService('handoff', 'registration')
        expect(rows).toHaveLength(0)
        expect(cookies.has('handoff')).toBe(false)
    })

    it('cleans up the handoff if cookie issuance fails', async () => {
        setCookie.mockImplementationOnce(() => { throw new Error('Cookie failure') })
        await expect(createSocialHandoffService('handoff', 'github', 'link_completion', payload, 60_000)).rejects.toThrow('Cookie failure')
        expect(rows).toHaveLength(0)
    })

    it('uses HttpOnly, SameSite=Lax and a callback path with Secure on HTTPS', () => {
        const token = createSocialTokenService()
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        setSocialCookieService('flow', token, 60_000, '/api/auth/github/callback')
        expect(setCookie).toHaveBeenCalledWith('flow', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/github/callback', maxAge: 60 })
        origin.mockReturnValue(new URL('http://localhost:3000'))
        setSocialCookieService('flow', token, 60_000)
        expect(setCookie).toHaveBeenLastCalledWith('flow', token, { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 60 })
    })
})
