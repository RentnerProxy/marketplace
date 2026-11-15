import { createServerFn } from '@tanstack/react-start'
import { getMaintenancePageStatusService } from '@/server/Maintenance/get.service.ts'
import { requestMaintenanceExtensionService } from '@/server/Maintenance/request.service.ts'
import { requestMaintenanceExtensionInputSchema } from './validation.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export const getMaintenancePageStatusHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    return getMaintenancePageStatusService()
})

export const requestMaintenanceExtensionHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return requestMaintenanceExtensionInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceRateLimit({
            ...RATE_LIMITS.maintenanceExtensionRequest,
            scope: 'maintenance-extension-request',
        })
        return requestMaintenanceExtensionService(data)
    })
