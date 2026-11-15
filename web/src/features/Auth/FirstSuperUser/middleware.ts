import { createServerFn } from '@tanstack/react-start'
import { createFirstSuperUserAccountInputSchema } from './validation.ts'
import {
    createFirstSuperUserAccountService,
    getFirstSuperUserSetupStatusService,
} from '@/server/SystemBootstrap/first-super-user.service.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export const getFirstSuperUserSetupStatusHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    return getFirstSuperUserSetupStatusService()
})

export const createFirstSuperUserAccountHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return createFirstSuperUserAccountInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceRateLimit({
            ...RATE_LIMITS.firstUserSetupIp,
            scope: 'first-user-setup-ip',
        })
        await enforceRateLimit({
            ...RATE_LIMITS.firstUserSetup,
            scope: 'first-user-setup',
            identifiers: [data.username, data.email],
        })
        return createFirstSuperUserAccountService(data)
    })
