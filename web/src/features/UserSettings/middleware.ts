import { createServerFn } from '@tanstack/react-start'
import {
    beginCurrentUserPasskeyRegistrationInputSchema,
    beginCurrentUserTwoFactorSetupInputSchema,
    confirmCurrentUserTwoFactorSetupInputSchema,
    deleteCurrentUserPasskeyInputSchema,
    disableCurrentUserTwoFactorInputSchema,
    finishCurrentUserPasskeyRegistrationInputSchema,
    updateCurrentUserBackgroundAppearanceInputSchema,
    updateCurrentUserBackgroundInputSchema,
    updateCurrentUserFontFamilyInputSchema,
    updateCurrentUserFontSizeInputSchema,
    updateCurrentUserPersonalInfoInputSchema,
    updateCurrentUserPrimaryColorInputSchema,
    updateCurrentUserProfileImageInputSchema,
    updateCurrentUserThemeModeInputSchema,
} from '@/features/UserSettings/validation.ts'
import {
    beginCurrentUserTwoFactorSetupService,
    confirmCurrentUserTwoFactorSetupService,
    disableCurrentUserTwoFactorService,
    getCurrentTwoFactorStatusService,
} from '@/server/UserSettings/Security/two-factor.service.ts'
import { requestCurrentUserPasswordResetService } from '@/server/UserSettings/Security/password-reset.service.ts'
import {
    deleteCurrentUserPasskeyService,
    getCurrentUserPasskeysService,
} from '@/server/Auth/Passkey/management.service.ts'
import {
    beginCurrentUserPasskeyRegistrationService,
    finishCurrentUserPasskeyRegistrationService,
} from '@/server/Auth/Passkey/registration.service.ts'
import {
    updateCurrentUserBackgroundAppearanceService,
    updateCurrentUserBackgroundService,
    deleteCurrentUserBackgroundService,
} from '@/server/UserSettings/background.service.ts'
import {
    updateCurrentUserPersonalInfoService,
    updateCurrentUserProfileImageService,
} from '@/server/UserSettings/profile.service.ts'
import {
    resetCurrentUserPrimaryColorService,
    updateCurrentUserFontFamilyService,
    updateCurrentUserFontSizeService,
    updateCurrentUserPrimaryColorService,
    updateCurrentUserThemeModeService,
} from '@/server/UserSettings/theme.service.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { enforceAuthenticationRateLimitService } from '@/server/Auth/authentication-rate-limit.service.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'

import type { SecurityOperationRateLimit } from './Types/user-settings-rate-limit.types.ts'

async function enforceCurrentUserSettingsMutationRateLimits(userId: string) {
    await enforceRateLimit({
        ...RATE_LIMITS.currentUserSettingsBurst,
        scope: 'current-user-settings-burst',
        identifiers: [userId],
        includeClientIp: false,
    })
    await enforceRateLimit({
        ...RATE_LIMITS.currentUserSettingsDaily,
        scope: 'current-user-settings-daily',
        identifiers: [userId],
        includeClientIp: false,
    })
}

async function enforceCurrentUserSecurityOperationRateLimit(
    scope: string,
    ipLimit: SecurityOperationRateLimit,
    accountLimit: SecurityOperationRateLimit,
) {
    await enforceAuthenticationRateLimitService('reauthentication', {
        ...ipLimit,
        scope: `${scope}-ip`,
    })

    const currentUserId = await getCurrentSessionUserId()

    if (currentUserId) {
        await enforceAuthenticationRateLimitService('reauthentication', {
            ...accountLimit,
            scope: `${scope}-account`,
            identifiers: [currentUserId],
            includeClientIp: false,
        })
    }
}

export const updateCurrentUserPersonalInfoHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserPersonalInfoInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserPersonalInfoService(data)
    })

export const requestCurrentUserPasswordResetHandler = createServerFn({
    method: 'POST',
}).handler(async function () {
    await requireAuthenticatedFeatureAccessService()
    await enforceRateLimit({
        ...RATE_LIMITS.currentUserPasswordResetIp,
        scope: 'current-user-password-reset-ip',
    })

    const currentUserId = await getCurrentSessionUserId()

    if (currentUserId) {
        await enforceRateLimit({
            ...RATE_LIMITS.currentUserPasswordReset,
            scope: 'current-user-password-reset-account',
            identifiers: [currentUserId],
            includeClientIp: false,
        })
    }

    return requestCurrentUserPasswordResetService()
})

export const updateCurrentUserProfileImageHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserProfileImageInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        await enforceRateLimit({
            ...RATE_LIMITS.imageUpload,
            scope: 'profile-image-upload',
        })
        return updateCurrentUserProfileImageService(data)
    })

export const updateCurrentUserPrimaryColorHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserPrimaryColorInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserPrimaryColorService(data)
    })

export const resetCurrentUserPrimaryColorHandler = createServerFn({
    method: 'POST',
}).handler(async function () {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
    return resetCurrentUserPrimaryColorService()
})

export const updateCurrentUserThemeModeHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserThemeModeInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserThemeModeService(data)
    })

export const updateCurrentUserFontFamilyHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserFontFamilyInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserFontFamilyService(data)
    })

export const updateCurrentUserFontSizeHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserFontSizeInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserFontSizeService(data)
    })

export const updateCurrentUserBackgroundHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserBackgroundInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        await enforceRateLimit({
            ...RATE_LIMITS.imageUpload,
            scope: 'background-image-upload',
        })
        return updateCurrentUserBackgroundService(data)
    })

export const updateCurrentUserBackgroundAppearanceHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return updateCurrentUserBackgroundAppearanceInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
        return updateCurrentUserBackgroundAppearanceService(data)
    })

export const deleteCurrentUserBackgroundHandler = createServerFn({
    method: 'POST',
}).handler(async function () {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    await enforceCurrentUserSettingsMutationRateLimits(sessionUser.id)
    return deleteCurrentUserBackgroundService()
})

export const getCurrentTwoFactorStatusHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await requireAuthenticatedFeatureAccessService()
    return getCurrentTwoFactorStatusService()
})

export const beginCurrentUserTwoFactorSetupHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return beginCurrentUserTwoFactorSetupInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSecurityOperationRateLimit(
            'current-user-two-factor-setup-begin',
            RATE_LIMITS.currentUserReauthenticationIp,
            RATE_LIMITS.currentUserReauthenticationAccount,
        )
        return beginCurrentUserTwoFactorSetupService(data)
    })

export const confirmCurrentUserTwoFactorSetupHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return confirmCurrentUserTwoFactorSetupInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSecurityOperationRateLimit(
            'current-user-two-factor-setup-confirm',
            RATE_LIMITS.currentUserReauthenticationIp,
            RATE_LIMITS.currentUserReauthenticationAccount,
        )
        return confirmCurrentUserTwoFactorSetupService(data)
    })

export const disableCurrentUserTwoFactorHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return disableCurrentUserTwoFactorInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        return disableCurrentUserTwoFactorService(data)
    })

export const getCurrentUserPasskeysHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await requireAuthenticatedFeatureAccessService()
    return getCurrentUserPasskeysService()
})

export const beginCurrentUserPasskeyRegistrationHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return beginCurrentUserPasskeyRegistrationInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSecurityOperationRateLimit(
            'current-user-passkey-registration-begin',
            RATE_LIMITS.passkeyBeginIp,
            RATE_LIMITS.passkeyBegin,
        )
        return beginCurrentUserPasskeyRegistrationService(data)
    })

export const finishCurrentUserPasskeyRegistrationHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return finishCurrentUserPasskeyRegistrationInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        await enforceCurrentUserSecurityOperationRateLimit(
            'current-user-passkey-registration-finish',
            RATE_LIMITS.passkeyFinishIp,
            RATE_LIMITS.passkeyFinish,
        )
        return finishCurrentUserPasskeyRegistrationService(data)
    })

export const deleteCurrentUserPasskeyHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return deleteCurrentUserPasskeyInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        return deleteCurrentUserPasskeyService(data)
    })
