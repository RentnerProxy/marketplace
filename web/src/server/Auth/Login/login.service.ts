import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { consumeTotpCodeService } from '@/server/Auth/totp-verification.service.ts'
import { twoFactorAuth, users } from '@/db/schema.ts'
import { hasTrustedDevice } from '@/server/Auth/Login/get.service.ts'
import type { LoginInput } from '@/features/Auth/Login/Types/login-server-input.types.ts'
import { logError, logWarn } from '@/server/Logging/logger.ts'
import { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import { claimLoginRecoveryAttemptService } from '@/server/Auth/Login/recovery.service.ts'
import type { LoginRecoveryAttempt } from '@/server/Auth/Types/login-recovery.types.ts'

const dummyPasswordHash = Bun.password.hash(
    `rentnerproxy-marketplace-login-dummy-${crypto.randomUUID()}`,
)

export async function loginService(
    data: LoginInput,
    recoveryAttempt?: LoginRecoveryAttempt,
) {
    try {
        const userResult = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.username, data.username),
                    eq(users.isDeleted, false),
                ),
            )
            .limit(1)

        const user = userResult.at(0)
        const preparedDummyPasswordHash = await dummyPasswordHash

        const validPassword = await Bun.password.verify(
            data.password,
            user?.passwordHash ?? preparedDummyPasswordHash,
        )

        if (!user || !validPassword) {
            return {
                success: false as const,
                code: 'INVALID_CREDENTIALS' as const,
                error: 'Ungültige Anmeldedaten.',
            }
        }

        if (!user.isActive) {
            return {
                success: false as const,
                code: 'USER_INACTIVE' as const,
                error: 'Dieser Benutzer ist deaktiviert.',
            }
        }

        const twoFactorRows = await db
            .select()
            .from(twoFactorAuth)
            .where(eq(twoFactorAuth.userId, user.id))
            .limit(1)
        const twoFactor = twoFactorRows.at(0)
        const hasVerifiedTwoFactor = Boolean(twoFactor?.verified)

        if (user.isTwoFactorEnabled !== hasVerifiedTwoFactor) {
            logWarn('auth.login.two_factor_configuration_invalid', {
                userId: user.id,
            })
            return {
                success: false as const,
                code: 'TWO_FACTOR_CONFIGURATION_INVALID' as const,
                error: 'Die Zwei-Faktor-Authentifizierung ist nicht vollständig eingerichtet. Bitte wende dich an einen Administrator.',
            }
        }

        let trustThisDevice = false

        if (user.isTwoFactorEnabled && twoFactor) {
            const trustedDevice = await hasTrustedDevice(user.id)
            const twoFactorCode = data.twoFactorCode

            if (!trustedDevice) {
                if (!twoFactorCode) {
                    return {
                        success: false as const,
                        code: 'TWO_FACTOR_REQUIRED' as const,
                        requiresTwoFactor: true,
                        error: 'Bitte gib deinen 2FA-Code ein.',
                    }
                }

                if (!(await consumeTotpCodeService(twoFactor, twoFactorCode))) {
                    return {
                        success: false as const,
                        code: 'INVALID_TWO_FACTOR' as const,
                        requiresTwoFactor: true,
                        error: 'Der 2FA-Code ist ungültig.',
                    }
                }
            }

            trustThisDevice = !trustedDevice && Boolean(data.trustThisDevice)
        }

        if (
            recoveryAttempt &&
            !(await claimLoginRecoveryAttemptService(recoveryAttempt, user))
        ) {
            return {
                success: false as const,
                code: 'INVALID_CREDENTIALS' as const,
                error: 'Ungültige Anmeldedaten.',
            }
        }

        return await createAuthenticatedSessionForUser({
            user,
            proof: {
                kind: 'password',
                trustThisDevice,
                factorId: twoFactor?.verified ? twoFactor.id : null,
            },
            auditAction: 'auth.login',
            auditMessage: `Benutzer ${user.username} hat sich angemeldet.`,
        })
    } catch (error) {
        logError('auth.login.failed', error)
        return {
            success: false as const,
            code: 'INTERNAL_ERROR' as const,
            error: 'Login konnte serverseitig nicht verarbeitet werden.',
        }
    }
}
