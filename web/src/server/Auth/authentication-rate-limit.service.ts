import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import type { RateLimitOptions } from '@/server/RateLimit/Types/rate-limit.types.ts'
import { recordRejectedAuthenticationService } from './rejected-authentication.service.ts'
import type { RejectedAuthenticationFlow } from './Types/rejected-authentication.types.ts'

export async function enforceAuthenticationRateLimitService(
    flow: RejectedAuthenticationFlow,
    options: RateLimitOptions,
) {
    try {
        await enforceRateLimit(options)
    } catch (error) {
        if (error instanceof RateLimitError) {
            recordRejectedAuthenticationService(flow, 'rate_limited')
        }
        throw error
    }
}
