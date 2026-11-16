import { createServerFn } from '@tanstack/react-start'
import {
    registrationInputSchema,
    verifyRegistrationInputSchema,
} from './validation.ts'
import { registerService } from '@/server/Auth/Registration/register.service.ts'
import { verifyRegistrationService } from '@/server/Auth/Registration/verify.service.ts'
import { RATE_LIMITS, REGISTRATION_POLICY } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import type {
    RegistrationResult,
    VerifyRegistrationResult,
} from './Types/registration.types.ts'

export const registerHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => registrationInputSchema.parse(data))
    .handler(async ({ data }): Promise<RegistrationResult> => {
        const protection = createEnumerationProtection(
            REGISTRATION_POLICY.minimumResponseMs,
        )
        try {
            await enforceRateLimit({
                ...RATE_LIMITS.registrationIp,
                scope: 'registration-ip',
            })
            await enforceRateLimit({
                ...RATE_LIMITS.registrationAccount,
                scope: 'registration-account',
                identifiers: [data.email],
                includeClientIp: false,
            })
            return await registerService(data)
        } catch (error) {
            logError('auth.registration.failed', error)
            return { success: false, error: 'registration.failed' }
        } finally {
            await protection.wait()
        }
    })

export const verifyRegistrationHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => verifyRegistrationInputSchema.parse(data))
    .handler(async ({ data }): Promise<VerifyRegistrationResult> => {
        try {
            await enforceRateLimit({
                ...RATE_LIMITS.registrationVerifyIp,
                scope: 'registration-verify-ip',
            })
            return await verifyRegistrationService(data)
        } catch (error) {
            logError('auth.registration.verification_failed', error)
            return { success: false, error: 'registration.invalidVerification' }
        }
    })
