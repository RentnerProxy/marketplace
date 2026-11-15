import { createServerFn } from '@tanstack/react-start'
import {
    beginPasskeyLoginInputSchema,
    finishPasskeyLoginInputSchema,
    loginInputSchema,
} from '@/features/Auth/Login/validation.ts'
import { loginService } from '@/server/Auth/Login/login.service.ts'
import { reserveLoginRecoveryAttemptService } from '@/server/Auth/Login/recovery.service.ts'
import {
    beginPasskeyLoginService,
    finishPasskeyLoginService,
} from '@/server/Auth/Passkey/login.service.ts'
import {
    AUTH_ENUMERATION_PROTECTION,
    RATE_LIMITS,
} from '@/config/security.config.ts'
import { RateLimitError } from '@/server/RateLimit/rateLimit.service.ts'
import { enforceAuthenticationRateLimitService } from '@/server/Auth/authentication-rate-limit.service.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import {
    finishLoginAttemptService,
    recordFailedLogin,
    reserveLoginAttemptService,
} from '@/server/RateLimit/login-attempt.service.ts'
import { notifyExistingUserAboutFailedLogin } from '@/server/Auth/Login/failedLoginAlert.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'

function isFailedLogin(result: Awaited<ReturnType<typeof loginService>>) {
    return (
        !result.success &&
        (result.code === 'INVALID_CREDENTIALS' ||
            result.code === 'INVALID_TWO_FACTOR')
    )
}

function recordRejectedPasswordLogin(
    result: Awaited<ReturnType<typeof loginService>>,
) {
    if (result.success) return
    switch (result.code) {
        case 'INVALID_CREDENTIALS':
            recordRejectedAuthenticationService(
                'password_login',
                'invalid_credentials',
            )
            return
        case 'INVALID_TWO_FACTOR':
            recordRejectedAuthenticationService(
                'password_login',
                'invalid_two_factor',
            )
            return
        case 'USER_INACTIVE':
            recordRejectedAuthenticationService(
                'password_login',
                'inactive_account',
            )
    }
}

export const loginHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return loginInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const enumerationProtection = createEnumerationProtection(
            AUTH_ENUMERATION_PROTECTION.loginMinimumResponseMs,
        )
        const lockoutEnumerationProtection = createEnumerationProtection(
            AUTH_ENUMERATION_PROTECTION.loginLockoutMinimumResponseMs,
        )
        let createdLockout = false

        try {
            await enforceAuthenticationRateLimitService('password_login', {
                ...RATE_LIMITS.loginIp,
                scope: 'login-ip',
            })
            const recoveryAttempt = await reserveLoginRecoveryAttemptService(
                data.username,
            )
            const admission = recoveryAttempt
                ? null
                : await reserveLoginAttemptService(data.username)

            if (admission && !admission.allowed) {
                if (admission.lockCreated) {
                    createdLockout = true
                    await notifyExistingUserAboutFailedLogin(data.username)
                }
                recordRejectedAuthenticationService(
                    'password_login',
                    admission.lockCreated
                        ? 'account_lock_created'
                        : admission.reason === 'locked'
                          ? 'account_locked'
                          : 'attempts_busy',
                )
                throw new RateLimitError(admission.retryAfterSeconds)
            }

            const normalAttempt = admission?.allowed ? admission.attempt : null
            let result: Awaited<ReturnType<typeof loginService>> | undefined
            let completion: Awaited<
                ReturnType<typeof finishLoginAttemptService>
            > | null = null
            let completionFailed = false
            let completionError: unknown

            try {
                result = await loginService(data, recoveryAttempt ?? undefined)
            } finally {
                if (normalAttempt) {
                    const outcome = result?.success
                        ? 'success'
                        : result && isFailedLogin(result)
                          ? 'failure'
                          : 'neutral'
                    try {
                        completion = await finishLoginAttemptService(
                            data.username,
                            normalAttempt,
                            outcome,
                        )
                    } catch (error) {
                        logError('auth.login.attempt_completion_failed', error)

                        completionFailed = true
                        completionError = error
                    }
                }
            }

            if (completionFailed && !result.success) {
                throw completionError
            }

            const lock =
                recoveryAttempt && isFailedLogin(result)
                    ? await recordFailedLogin(data.username)
                    : completion

            if (lock?.lockCreated) {
                createdLockout = true
                await notifyExistingUserAboutFailedLogin(data.username)
            }
            if (lock && lock.lockDurationSeconds > 0 && !result.success) {
                recordRejectedAuthenticationService(
                    'password_login',
                    lock.lockCreated
                        ? 'account_lock_created'
                        : 'account_locked',
                )
                throw new RateLimitError(lock.lockDurationSeconds)
            }

            recordRejectedPasswordLogin(result)
            return result
        } finally {
            await (
                createdLockout
                    ? lockoutEnumerationProtection
                    : enumerationProtection
            ).wait()
        }
    })

export const beginPasskeyLoginHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return beginPasskeyLoginInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceAuthenticationRateLimitService('passkey_login', {
            ...RATE_LIMITS.passkeyBeginIp,
            scope: 'passkey-begin-ip',
        })
        await enforceAuthenticationRateLimitService('passkey_login', {
            ...RATE_LIMITS.passkeyBegin,
            scope: 'passkey-begin',
            identifiers: [data.username],
        })
        return beginPasskeyLoginService(data)
    })

export const finishPasskeyLoginHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return finishPasskeyLoginInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceAuthenticationRateLimitService('passkey_login', {
            ...RATE_LIMITS.passkeyFinishIp,
            scope: 'passkey-finish-ip',
        })
        await enforceAuthenticationRateLimitService('passkey_login', {
            ...RATE_LIMITS.passkeyFinish,
            scope: 'passkey-finish',
            identifiers: [data.challengeId],
        })
        return finishPasskeyLoginService(data)
    })
