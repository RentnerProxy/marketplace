import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { and, eq, gt, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { socialAuthChallenges } from '@/db/Schema/socialAuth.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { decryptAuthSecret, encryptAuthSecret } from '@/lib/Auth/secretEncryption.ts'
import { getSocialAuthOriginService } from './config.service.ts'
import type { StoreSocialChallengeInput, SocialChallengePurpose } from './Types/social-challenge.types.ts'

const challengeEnvelopeSchema = z.object({
    tokenHash: z.string(), browserHash: z.string(), provider: z.string(), purpose: z.string(), payload: z.unknown(),
})
export const socialTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export function createSocialTokenService() {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

export async function storeSocialChallengeService(input: StoreSocialChallengeInput) {
    const tokenHash = await createTokenHash(input.token)
    const browserHash = await createTokenHash(input.browserToken)
    const row = { tokenHash, browserHash, provider: input.provider, purpose: input.purpose }
    await (input.transaction ?? db).insert(socialAuthChallenges).values({
        ...row,
        payload: await encryptAuthSecret(JSON.stringify({ ...row, payload: input.payload })),
        expiresAt: new Date(Date.now() + input.durationMs),
    })
    return tokenHash
}

export async function readSocialChallengeService(token: string, browserToken: string, purpose: SocialChallengePurpose, provider?: string, consume = false) {
    if (!socialTokenSchema.safeParse(token).success || !socialTokenSchema.safeParse(browserToken).success) return null
    const condition = and(
        eq(socialAuthChallenges.tokenHash, await createTokenHash(token)),
        eq(socialAuthChallenges.browserHash, await createTokenHash(browserToken)),
        eq(socialAuthChallenges.purpose, purpose),
        ...(provider ? [eq(socialAuthChallenges.provider, provider)] : []),
        gt(socialAuthChallenges.expiresAt, new Date()),
    )
    const rows = consume
        ? await db.delete(socialAuthChallenges).where(condition).returning()
        : await db.select().from(socialAuthChallenges).where(condition).limit(1)
    const row = rows.at(0)
    if (!row) return null
    const envelope = challengeEnvelopeSchema.parse(JSON.parse(await decryptAuthSecret(row.payload)))
    if (envelope.tokenHash !== row.tokenHash || envelope.browserHash !== row.browserHash || envelope.provider !== row.provider || envelope.purpose !== row.purpose) return null
    return { ...row, payload: envelope.payload }
}

export function setSocialCookieService(name: string, value: string, durationMs: number, path = '/') {
    const secure = getSocialAuthOriginService().protocol === 'https:'
    setCookie(name, value, { httpOnly: true, secure, sameSite: 'lax', path, maxAge: Math.floor(durationMs / 1000) })
}

export function getSocialHandoffCookieService(name: string) {
    const [token, browserToken, extra] = (getCookie(name) ?? '').split('.')
    return token && browserToken && !extra && socialTokenSchema.safeParse(token).success && socialTokenSchema.safeParse(browserToken).success ? { token, browserToken } : null
}

export async function createSocialHandoffService(name: string, provider: StoreSocialChallengeInput['provider'], purpose: SocialChallengePurpose, payload: unknown, durationMs: number, path = '/') {
    const previous = getSocialHandoffCookieService(name)
    if (previous) await readSocialChallengeService(previous.token, previous.browserToken, purpose, undefined, true)
    const token = createSocialTokenService()
    const browserToken = createSocialTokenService()
    await storeSocialChallengeService({ token, browserToken, provider, purpose, payload, durationMs })
    try {
        setSocialCookieService(name, `${token}.${browserToken}`, durationMs, path)
    } catch (error) {
        await readSocialChallengeService(token, browserToken, purpose, undefined, true)
        throw error
    }
}

export async function clearSocialHandoffService(name: string, purpose: SocialChallengePurpose) {
    const cookie = getSocialHandoffCookieService(name)
    if (cookie) await readSocialChallengeService(cookie.token, cookie.browserToken, purpose, undefined, true)
    deleteCookie(name, { path: '/' })
}

export async function cleanupExpiredSocialChallengesService() {
    await db.delete(socialAuthChallenges).where(lte(socialAuthChallenges.expiresAt, new Date()))
}
