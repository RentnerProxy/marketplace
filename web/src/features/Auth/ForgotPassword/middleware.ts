import { createServerFn } from '@tanstack/react-start'
import { requestPasswordResetInputSchema } from '@/features/Auth/ForgotPassword/validation.ts'
import { requestPasswordResetService } from '@/server/Auth/ForgotPassword/request.service.ts'
import {
    AUTH_ENUMERATION_PROTECTION,
    RATE_LIMITS,
} from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'
import { logError } from '@/server/Logging/logger.ts'

export const requestPasswordResetHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return requestPasswordResetInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const enumerationProtection = createEnumerationProtection(
            AUTH_ENUMERATION_PROTECTION.passwordResetMinimumResponseMs,
        )
        const responseDeadline = enumerationProtection.wait()

        try {
            const email = data.email.trim().toLowerCase()

            await enforceRateLimit({
                ...RATE_LIMITS.passwordResetRequestIp,
                scope: 'password-reset-request-ip',
            })
            await enforceRateLimit({
                ...RATE_LIMITS.passwordResetRequestAccount,
                scope: 'password-reset-request-account',
                identifiers: [email],
                includeClientIp: false,
            })

            const resetRequest = requestPasswordResetService({ email }).catch(
                function (error) {
                    logError('auth.password_reset.request_failed', error)
                },
            )

            await Promise.race([resetRequest, responseDeadline])
            return { success: true as const }
        } finally {
            await responseDeadline
        }
    })
