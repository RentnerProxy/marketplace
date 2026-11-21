import { createServerFn } from '@tanstack/react-start'
import {
    resolveMaintenanceExtensionRequestInputSchema,
    updateCompanyNameInputSchema,
    updateMaintenanceModeInputSchema,
    updatePublicRegistrationInputSchema,
    updateSystemLogoInputSchema,
} from '@/features/Admin/SystemSettings/validation.ts'
import {
    getPublicSystemSettingsService,
    getSystemSettingsService,
} from '@/server/Admin/SystemSettings/get.service.ts'
import {
    updateSystemLogoService,
    updateCompanyNameService,
} from '@/server/Admin/SystemSettings/branding.service.ts'
import { resolveMaintenanceExtensionRequestService } from '@/server/Admin/SystemSettings/maintenance-extension.service.ts'
import { updateMaintenanceModeService } from '@/server/Admin/SystemSettings/maintenance-mode.service.ts'
import { updatePublicRegistrationService } from '@/server/Admin/SystemSettings/public-registration.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

async function enforceSystemSettingsMutationRateLimits(userId: string) {
    await enforceRateLimit({
        ...RATE_LIMITS.systemSettingsMutationBurst,
        scope: 'system-settings-mutation-burst',
        identifiers: [userId],
        includeClientIp: false,
    })
    await enforceRateLimit({
        ...RATE_LIMITS.systemSettingsMutationDaily,
        scope: 'system-settings-mutation-daily',
        identifiers: [userId],
        includeClientIp: false,
    })
}

export const getSystemSettingsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    return getPublicSystemSettingsService()
})

export const getAdminSystemSettingsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await requirePermissionService(PERMISSIONS.ADMIN_SYSTEM_SETTINGS)
    return getSystemSettingsService()
})

export const updateCompanyNameHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateCompanyNameInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        await enforceSystemSettingsMutationRateLimits(userId)
        return updateCompanyNameService(data, userId)
    })

export const updateSystemLogoHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateSystemLogoInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        await enforceSystemSettingsMutationRateLimits(userId)
        await enforceRateLimit({
            ...RATE_LIMITS.imageUpload,
            scope: 'system-logo-upload',
        })
        return updateSystemLogoService(data, userId)
    })

export const updateMaintenanceModeHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateMaintenanceModeInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        await enforceSystemSettingsMutationRateLimits(userId)
        return updateMaintenanceModeService(data, userId)
    })

export const updatePublicRegistrationHandler = createServerFn({
    method: 'POST',
})
    .validator((data: unknown) =>
        updatePublicRegistrationInputSchema.parse(data),
    )
    .handler(async ({ data }) => {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        await enforceSystemSettingsMutationRateLimits(userId)
        return updatePublicRegistrationService(data.isEnabled, userId)
    })

export const resolveMaintenanceExtensionRequestHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return resolveMaintenanceExtensionRequestInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        await enforceSystemSettingsMutationRateLimits(userId)
        return resolveMaintenanceExtensionRequestService(data, userId)
    })
