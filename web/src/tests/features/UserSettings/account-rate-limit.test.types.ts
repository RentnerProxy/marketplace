import type { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export type AccountRateLimitTestOptions = Parameters<typeof enforceRateLimit>[0]
export type AccountRateLimitTestCounter = { count: number; expiresAt: number }
