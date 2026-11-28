import { createServerFn } from '@tanstack/react-start'
import { RATE_LIMITS } from '@/config/security.config.ts'
import {
    followUserInputSchema,
    getProfileAppsInputSchema,
    getProfileFollowsInputSchema,
    getPublicProfileInputSchema,
    searchProfilesInputSchema,
    starAppInputSchema,
} from '@/features/Social/validation.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import {
    followUserService,
    unfollowUserService,
} from '@/server/Social/follows.service.ts'
import { getProfileAppsService } from '@/server/Social/profileApps.service.ts'
import {
    getProfileFollowsService,
    getPublicProfileService,
    searchProfilesService,
} from '@/server/Social/profiles.service.ts'
import {
    starAppService,
    unstarAppService,
} from '@/server/Social/stars.service.ts'

async function enforcePublicProfileReadLimit() {
    await enforceRateLimit({
        ...RATE_LIMITS.socialProfileRead,
        scope: 'social-profile-read',
    })
}

/** Public: anyone may open a profile; the viewer id only marks follow state. */
export const getPublicProfileHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return getPublicProfileInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforcePublicProfileReadLimit()
        return getPublicProfileService(data, await getCurrentSessionUserId())
    })

/** Public: follower and following lists of a visible profile. */
export const getProfileFollowsHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return getProfileFollowsInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforcePublicProfileReadLimit()
        return getProfileFollowsService(data, await getCurrentSessionUserId())
    })

/** Signed-in people search. */
export const searchProfilesHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return searchProfilesInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser } = await requireAuthenticatedFeatureAccessService()
        await enforceRateLimit({
            ...RATE_LIMITS.socialSearch,
            scope: 'social-search',
            identifiers: [sessionUser.id],
        })
        return searchProfilesService(data, sessionUser.id)
    })

async function requireFollowActor() {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    await enforceRateLimit({
        ...RATE_LIMITS.socialFollow,
        scope: 'social-follow',
        identifiers: [sessionUser.id],
        includeClientIp: false,
    })
    return sessionUser
}

export const followUserHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return followUserInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const sessionUser = await requireFollowActor()
        return followUserService(data, sessionUser)
    })

export const unfollowUserHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return followUserInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const sessionUser = await requireFollowActor()
        return unfollowUserService(data, sessionUser.id)
    })

/** Public: published apps of a visible profile; the viewer id only marks stars. */
export const getProfileAppsHandler = createServerFn({ method: 'GET' })
    .validator(function (data: unknown) {
        return getProfileAppsInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await enforcePublicProfileReadLimit()
        return getProfileAppsService(data, await getCurrentSessionUserId())
    })

async function requireStarActor() {
    const { sessionUser } = await requireAuthenticatedFeatureAccessService()
    await enforceRateLimit({
        ...RATE_LIMITS.appStar,
        scope: 'app-star',
        identifiers: [sessionUser.id],
        includeClientIp: false,
    })
    return sessionUser
}

export const starAppHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return starAppInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const sessionUser = await requireStarActor()
        return starAppService(data, sessionUser.id)
    })

export const unstarAppHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return starAppInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const sessionUser = await requireStarActor()
        return unstarAppService(data, sessionUser.id)
    })
