import type { PasskeyChallengeType } from './Types/passkey-challenge.types.ts'
import { and, eq, gt, lt } from 'drizzle-orm'
import { PASSKEY_CHALLENGE_DURATION_MS } from '@/config/security.config.ts'
import { db } from '@/db'
import { passkeyChallenges } from '@/db/schema.ts'

export const REGISTRATION_CHALLENGE_TYPE = 'registration-policy-bound-v4'
export const AUTHENTICATION_CHALLENGE_TYPE = 'authentication-discoverable-v2'

export function getChallengeExpiresAt() {
    return new Date(Date.now() + PASSKEY_CHALLENGE_DURATION_MS)
}

export async function deleteExpiredPasskeyChallenges() {
    await db
        .delete(passkeyChallenges)
        .where(lt(passkeyChallenges.expiresAt, new Date()))
}

export async function consumeLatestValidChallenge(
    challengeId: string,
    type: PasskeyChallengeType,
    identifier?: string,
) {
    const rows = await db
        .delete(passkeyChallenges)
        .where(
            and(
                eq(passkeyChallenges.id, challengeId),
                eq(passkeyChallenges.type, type),
                gt(passkeyChallenges.expiresAt, new Date()),
                ...(identifier
                    ? [eq(passkeyChallenges.identifier, identifier)]
                    : []),
            ),
        )
        .returning()

    return rows.at(0) ?? null
}
