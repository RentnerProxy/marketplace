import { deleteCookie } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { users, twoFactorAuth } from '@/db/schema.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { SOCIAL_AUTH_POLICY } from '@/config/social-auth.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { consumeTotpCodeService } from '@/server/Auth/totp-verification.service.ts'
import { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import type { SocialIdentity } from '@/lib/Auth/Types/social-auth.types.ts'
import {
    createSocialHandoffService,
    getSocialHandoffCookieService,
    readSocialChallengeService,
} from './challenge.service.ts'

export const SOCIAL_LOGIN_COOKIE = 'marketplace_social_login'
const socialLoginSnapshotSchema = z.object({
    accountId: z.uuid(),
    factorId: z.uuid(),
    user: z.object({
        id: z.uuid(),
        username: z.string(),
        email: z.string(),
        passwordHash: z.string(),
        isActive: z.boolean(),
        isTwoFactorEnabled: z.literal(true),
    }),
})

export async function getSocialLoginChallengeService() {
    const cookie = getSocialHandoffCookieService(SOCIAL_LOGIN_COOKIE)
    return cookie
        ? readSocialChallengeService(
              cookie.token,
              cookie.browserToken,
              'two_factor',
          )
        : null
}

export async function signInSocialIdentityService(identity: SocialIdentity) {
    const rows = await db
        .select({ account: socialAccounts, user: users })
        .from(socialAccounts)
        .innerJoin(users, eq(users.id, socialAccounts.userId))
        .where(
            and(
                eq(socialAccounts.provider, identity.provider),
                eq(socialAccounts.subject, identity.subject),
            ),
        )
        .limit(1)
    const row = rows.at(0)
    if (!row) return { kind: 'registration' as const }
    if (!row.user.isActive || row.user.isDeleted)
        return { kind: 'error' as const, code: 'inactive' }
    const factors = await db
        .select()
        .from(twoFactorAuth)
        .where(eq(twoFactorAuth.userId, row.user.id))
        .limit(1)
    const factor = factors.at(0)
    if (row.user.isTwoFactorEnabled !== Boolean(factor?.verified))
        return { kind: 'error' as const, code: 'failed' }
    if (row.user.isTwoFactorEnabled && factor?.verified) {
        await createSocialHandoffService(
            SOCIAL_LOGIN_COOKIE,
            identity.provider,
            'two_factor',
            { accountId: row.account.id, factorId: factor.id, user: row.user },
            SOCIAL_AUTH_POLICY.secondFactorDurationMs,
        )
        return { kind: 'two_factor' as const }
    }
    const result = await createAuthenticatedSessionForUser({
        user: row.user,
        proof: { kind: 'social', accountId: row.account.id, factorId: null },
        auditAction: 'auth.social_login',
        auditMessage: `Anmeldung über ${identity.provider} bestätigt.`,
    })
    return result.success
        ? { kind: 'success' as const, redirectTo: result.redirectTo }
        : { kind: 'error' as const, code: 'failed' }
}

export async function finishSocialLoginService(twoFactorCode: string) {
    const failure = {
        success: false as const,
        error: 'Die Anbieter-Anmeldung konnte nicht bestätigt werden. Bitte starte erneut oder prüfe deinen 2FA-Code.',
    }
    const challenge = await getSocialLoginChallengeService()
    if (!challenge) return failure
    await enforceRateLimit({
        ...RATE_LIMITS.socialTwoFactorChallenge,
        scope: 'social-two-factor-challenge',
        identifiers: [challenge.tokenHash],
        includeClientIp: false,
    })
    const snapshot = socialLoginSnapshotSchema.parse(challenge.payload)
    const factors = await db
        .select()
        .from(twoFactorAuth)
        .where(
            and(
                eq(twoFactorAuth.id, snapshot.factorId),
                eq(twoFactorAuth.userId, snapshot.user.id),
            ),
        )
        .limit(1)
    const factor = factors.at(0)
    if (!factor || !(await consumeTotpCodeService(factor, twoFactorCode)))
        return failure
    const cookie = getSocialHandoffCookieService(SOCIAL_LOGIN_COOKIE)
    if (
        !cookie ||
        !(await readSocialChallengeService(
            cookie.token,
            cookie.browserToken,
            'two_factor',
            challenge.provider,
            true,
        ))
    )
        return failure
    deleteCookie(SOCIAL_LOGIN_COOKIE, { path: '/' })
    const result = await createAuthenticatedSessionForUser({
        user: snapshot.user,
        proof: {
            kind: 'social',
            accountId: snapshot.accountId,
            factorId: snapshot.factorId,
        },
        auditAction: 'auth.social_login',
        auditMessage: `Anmeldung über ${challenge.provider} mit Zwei-Faktor-Prüfung bestätigt.`,
    })
    return result.success
        ? { success: true as const, redirectTo: result.redirectTo }
        : failure
}
