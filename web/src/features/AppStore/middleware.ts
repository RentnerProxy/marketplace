import { createServerFn } from '@tanstack/react-start'
import { RATE_LIMITS } from '@/config/security.config.ts'
import {
    reorderStoreScreenshotsInputSchema,
    storeAppInputSchema,
    storeScreenshotInputSchema,
    updateStoreDescriptionInputSchema,
    uploadStoreImageInputSchema,
} from '@/features/AppStore/validation.ts'
import {
    getAppDetailService,
    listPublishedAppsService,
} from '@/server/AppStore/catalog.service.ts'
import {
    addStoreScreenshotService,
    getStoreEntryEditorService,
    listEditableStoreAppsService,
    removeStoreLogoService,
    removeStoreScreenshotService,
    reorderStoreScreenshotsService,
    updateStoreDescriptionService,
    uploadStoreLogoService,
} from '@/server/AppStore/entry.service.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

async function enforceStoreReadLimit() {
    await enforceRateLimit({
        ...RATE_LIMITS.appStoreRead,
        scope: 'app-store-read',
    })
}

/** Store edits are limited per account; ownership is checked by each service. */
async function enforceStoreEditLimit() {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    await enforceRateLimit({
        ...RATE_LIMITS.appStoreEdit,
        scope: 'app-store-edit',
        identifiers: [sessionUser.id],
        includeClientIp: false,
    })
}

/** Public: detail page of a published app. */
export const getAppDetailHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return storeAppInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreReadLimit()
        return getAppDetailService(data, await getCurrentSessionUserId())
    })

/** Public: published apps for the catalog page. */
export const listPublishedAppsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await enforceStoreReadLimit()
    return listPublishedAppsService(await getCurrentSessionUserId())
})

export const getStoreEntryEditorHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return storeAppInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        return getStoreEntryEditorService(data)
    })

export const listEditableStoreAppsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    return listEditableStoreAppsService(sessionUser.id)
})

export const updateStoreDescriptionHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateStoreDescriptionInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return updateStoreDescriptionService(data)
    })

export const uploadStoreLogoHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return uploadStoreImageInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return uploadStoreLogoService(data)
    })

export const removeStoreLogoHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return storeAppInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return removeStoreLogoService(data)
    })

export const addStoreScreenshotHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return uploadStoreImageInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return addStoreScreenshotService(data)
    })

export const removeStoreScreenshotHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return storeScreenshotInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return removeStoreScreenshotService(data)
    })

export const reorderStoreScreenshotsHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return reorderStoreScreenshotsInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforceStoreEditLimit()
        return reorderStoreScreenshotsService(data)
    })
