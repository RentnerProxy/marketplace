import { deleteCookie } from '@tanstack/react-start/server'
import { and, eq, gt } from 'drizzle-orm'
import { socialAuthChallenges } from '@/db/Schema/socialAuth.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { SocialRegistrationIdentity } from '@/lib/Auth/Types/social-auth.types.ts'
import {
    getSocialHandoffCookieService,
    readSocialChallengeService,
} from './challenge.service.ts'
import { socialIdentitySchema } from './validation.ts'

export const SOCIAL_REGISTRATION_COOKIE = 'marketplace_social_registration'

export async function getSocialRegistrationIdentityService(): Promise<SocialRegistrationIdentity | null> {
    const cookie = getSocialHandoffCookieService(SOCIAL_REGISTRATION_COOKIE)
    if (!cookie) return null
    const request = await readSocialChallengeService(
        cookie.token,
        cookie.browserToken,
        'registration',
    )
    if (!request) return null
    const identity = socialIdentitySchema.parse(request.payload)
    return identity.provider === request.provider
        ? { ...identity, requestId: request.tokenHash }
        : null
}

export async function consumeSocialRegistrationIdentityInTransactionService(
    transaction: DatabaseTransaction,
    requestId: string,
) {
    const cookie = getSocialHandoffCookieService(SOCIAL_REGISTRATION_COOKIE)
    if (!cookie || (await createTokenHash(cookie.token)) !== requestId)
        return false
    const rows = await transaction
        .delete(socialAuthChallenges)
        .where(
            and(
                eq(socialAuthChallenges.tokenHash, requestId),
                eq(
                    socialAuthChallenges.browserHash,
                    await createTokenHash(cookie.browserToken),
                ),
                eq(socialAuthChallenges.purpose, 'registration'),
                gt(socialAuthChallenges.expiresAt, new Date()),
            ),
        )
        .returning({ tokenHash: socialAuthChallenges.tokenHash })
    return rows.length === 1
}

export function clearSocialRegistrationCookieService() {
    deleteCookie(SOCIAL_REGISTRATION_COOKIE, { path: '/' })
}
