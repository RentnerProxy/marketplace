import { createServerFn } from '@tanstack/react-start'
import {
    requestPasswordResetTokenSchema,
    updatePasswordByTokenInputSchema,
} from '@/features/Auth/PasswordReset/validation.ts'
import { updatePasswordByTokenService } from '@/server/Auth/PasswordReset/update.service.ts'
import { validatePasswordResetTokenService } from '@/server/Auth/PasswordReset/get.service.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export const updatePasswordByTokenHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updatePasswordByTokenInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceRateLimit({
            ...RATE_LIMITS.passwordResetFinishIp,
            scope: 'password-reset-finish-ip',
        })
        await enforceRateLimit({
            ...RATE_LIMITS.passwordResetFinish,
            scope: 'password-reset-finish',
            identifiers: [data.token],
        })
        return updatePasswordByTokenService(data)
    })

export const validateTokenHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return requestPasswordResetTokenSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceRateLimit({
            ...RATE_LIMITS.passwordResetValidateIp,
            scope: 'password-reset-validate-ip',
        })
        return validatePasswordResetTokenService(data.token)
    })
