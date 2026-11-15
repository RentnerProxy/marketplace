import type { LockedReauthenticationState } from './Types/reauthentication.types.ts'
import { and, eq } from 'drizzle-orm'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { db } from '@/db'
import { twoFactorAuth, users } from '@/db/schema.ts'
import { consumeTotpCodeService } from '@/server/Auth/totp-verification.service.ts'
import type { CurrentUserReauthenticationInput } from '@/features/UserSettings/Types/user-settings-server-input.types.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { createReauthenticationProofService } from './reauthentication-proof.service.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import { enforceAuthenticationRateLimitService } from './authentication-rate-limit.service.ts'
import { recordRejectedAuthenticationService } from './rejected-authentication.service.ts'
import type { RejectedAuthenticationReason } from './Types/rejected-authentication.types.ts'

const REAUTHENTICATION_FAILED_ERROR =
    'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.'

function reauthenticationFailed(reason?: RejectedAuthenticationReason) {
    if (reason) recordRejectedAuthenticationService('reauthentication', reason)
    return {
        success: false as const,
        error: REAUTHENTICATION_FAILED_ERROR,
    }
}

function createVerifiedCurrentUser(
    currentUser: LockedReauthenticationState['currentUser'],
) {
    return {
        id: currentUser.id,
        username: currentUser.username,
        email: currentUser.email,
        isTwoFactorEnabled: currentUser.isTwoFactorEnabled,
    }
}

export async function reauthenticateCurrentUserService(
    reauthentication: CurrentUserReauthenticationInput,
) {
    const currentSession = await getActiveCurrentSessionUser()
    const currentUserId = currentSession?.id

    await enforceAuthenticationRateLimitService('reauthentication', {
        ...RATE_LIMITS.currentUserReauthenticationIp,
        scope: 'current-user-reauthentication-ip',
    })

    if (!currentUserId || !currentSession) {
        recordRejectedAuthenticationService(
            'reauthentication',
            'invalid_session',
        )
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    await enforceAuthenticationRateLimitService('reauthentication', {
        ...RATE_LIMITS.currentUserReauthenticationAccount,
        scope: 'current-user-reauthentication-account',
        identifiers: [currentUserId],
        includeClientIp: false,
    })

    const userRows = await db
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            passwordHash: users.passwordHash,
            isTwoFactorEnabled: users.isTwoFactorEnabled,
        })
        .from(users)
        .where(
            and(
                eq(users.id, currentUserId),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
            ),
        )
        .limit(1)
    const currentUser = userRows.at(0)

    if (!currentUser) {
        recordRejectedAuthenticationService(
            'reauthentication',
            'invalid_session',
        )
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    if (currentUser.isTwoFactorEnabled) {
        if (reauthentication.method !== 'totp') {
            return reauthenticationFailed('credential_method_mismatch')
        }

        const factorRows = await db
            .select({
                id: twoFactorAuth.id,
                userId: twoFactorAuth.userId,
                secret: twoFactorAuth.secret,
                verified: twoFactorAuth.verified,
            })
            .from(twoFactorAuth)
            .where(eq(twoFactorAuth.userId, currentUser.id))
            .limit(1)
        const factor = factorRows.at(0)

        if (!factor?.verified) {
            logWarn('auth.reauthentication.two_factor_configuration_invalid', {
                userId: currentUser.id,
            })
            return reauthenticationFailed()
        }

        try {
            const isValid = await consumeTotpCodeService(
                factor,
                reauthentication.credential,
            )

            if (!isValid) {
                return reauthenticationFailed('invalid_two_factor')
            }
        } catch {
            return reauthenticationFailed()
        }

        return {
            success: true as const,
            currentUser: createVerifiedCurrentUser(currentUser),
            proof: await createReauthenticationProofService(
                currentUser,
                factor.id,
                currentSession.sessionHash,
            ),
        }
    }

    if (reauthentication.method !== 'password') {
        return reauthenticationFailed('credential_method_mismatch')
    }

    try {
        const isValid = await Bun.password.verify(
            reauthentication.credential,
            currentUser.passwordHash,
        )

        if (!isValid) {
            return reauthenticationFailed('invalid_credentials')
        }
    } catch {
        return reauthenticationFailed()
    }

    return {
        success: true as const,
        currentUser: createVerifiedCurrentUser(currentUser),
        proof: await createReauthenticationProofService(
            currentUser,
            null,
            currentSession.sessionHash,
        ),
    }
}
