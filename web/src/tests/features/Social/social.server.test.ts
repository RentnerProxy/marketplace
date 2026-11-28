import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RATE_LIMITS } from '@/config/security.config.ts'

const sessionUser = {
    id: '019f72d1-dc60-7040-bdac-9e201573f001',
    username: 'ada',
}
const targetId = '019f72d1-dc60-7040-bdac-9e201573f002'
const appId = 'rentner.weather-widget'
const mocks = {
    requireAccess: vi.fn(async () => ({ sessionUser, permissionKeys: [] })),
    viewerId: vi.fn(async (): Promise<string | null> => null),
    rateLimit: vi.fn(async (_options: unknown) => {}),
    profile: vi.fn(async (..._args: Array<unknown>) => ({ id: targetId })),
    follows: vi.fn(async (..._args: Array<unknown>) => ({ profiles: [] })),
    search: vi.fn(async (..._args: Array<unknown>) => []),
    follow: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    unfollow: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    apps: vi.fn(async (..._args: Array<unknown>) => []),
    star: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    unstar: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
}

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => ({
        validator: (validate: (input: unknown) => unknown) => ({
            handler:
                (operation: (context: { data: unknown }) => Promise<unknown>) =>
                async (input: { data: unknown }) =>
                    operation({ data: validate(input.data) }),
        }),
    }),
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requireAuthenticatedFeatureAccessService: mocks.requireAccess,
}))
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentSessionUserId: mocks.viewerId,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: mocks.rateLimit,
}))
vi.mock('@/server/Social/profiles.service.ts', () => ({
    getPublicProfileService: mocks.profile,
    getProfileFollowsService: mocks.follows,
    searchProfilesService: mocks.search,
}))
vi.mock('@/server/Social/follows.service.ts', () => ({
    followUserService: mocks.follow,
    unfollowUserService: mocks.unfollow,
}))
vi.mock('@/server/Social/profileApps.service.ts', () => ({
    getProfileAppsService: mocks.apps,
}))
vi.mock('@/server/Social/stars.service.ts', () => ({
    starAppService: mocks.star,
    unstarAppService: mocks.unstar,
}))

const handlers = await import('@/features/Social/middleware.ts')

beforeEach(() => {
    vi.clearAllMocks()
    mocks.viewerId.mockResolvedValue(null)
})

describe('social server functions', () => {
    it('serves public profiles anonymously behind an IP rate limit', async () => {
        await handlers.getPublicProfileHandler({
            data: { username: ' kevin ' },
        })
        expect(mocks.requireAccess).not.toHaveBeenCalled()
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.socialProfileRead,
            scope: 'social-profile-read',
        })
        expect(mocks.profile).toHaveBeenCalledWith({ username: 'kevin' }, null)
    })

    it('passes the optional viewer to follower lists', async () => {
        mocks.viewerId.mockResolvedValue(sessionUser.id)
        await handlers.getProfileFollowsHandler({
            data: { username: 'kevin', list: 'followers' },
        })
        expect(mocks.follows).toHaveBeenCalledWith(
            { username: 'kevin', list: 'followers', offset: 0 },
            sessionUser.id,
        )
    })

    it('requires a session and an account rate limit for search', async () => {
        await handlers.searchProfilesHandler({ data: { query: 'ke' } })
        expect(mocks.requireAccess).toHaveBeenCalled()
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.socialSearch,
            scope: 'social-search',
            identifiers: [sessionUser.id],
        })
        expect(mocks.search).toHaveBeenCalledWith(
            { query: 'ke' },
            sessionUser.id,
        )
        await expect(
            handlers.searchProfilesHandler({ data: { query: 'k' } }),
        ).rejects.toThrow()
    })

    it('follows and unfollows only for the signed-in account', async () => {
        await handlers.followUserHandler({ data: { userId: targetId } })
        expect(mocks.follow).toHaveBeenCalledWith(
            { userId: targetId },
            sessionUser,
        )
        await handlers.unfollowUserHandler({ data: { userId: targetId } })
        expect(mocks.unfollow).toHaveBeenCalledWith(
            { userId: targetId },
            sessionUser.id,
        )
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.socialFollow,
            scope: 'social-follow',
            identifiers: [sessionUser.id],
            includeClientIp: false,
        })
        await expect(
            handlers.followUserHandler({ data: { userId: 'not-a-user' } }),
        ).rejects.toThrow()
    })

    it('lists profile apps publicly behind the profile read limit', async () => {
        mocks.viewerId.mockResolvedValue(sessionUser.id)
        await handlers.getProfileAppsHandler({ data: { username: 'kevin' } })
        expect(mocks.requireAccess).not.toHaveBeenCalled()
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.socialProfileRead,
            scope: 'social-profile-read',
        })
        expect(mocks.apps).toHaveBeenCalledWith(
            { username: 'kevin' },
            sessionUser.id,
        )
    })

    it('stars and unstars apps only for the signed-in account', async () => {
        await handlers.starAppHandler({ data: { appId } })
        expect(mocks.star).toHaveBeenCalledWith({ appId }, sessionUser.id)
        await handlers.unstarAppHandler({ data: { appId } })
        expect(mocks.unstar).toHaveBeenCalledWith({ appId }, sessionUser.id)
        expect(mocks.requireAccess).toHaveBeenCalledTimes(2)
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.appStar,
            scope: 'app-star',
            identifiers: [sessionUser.id],
            includeClientIp: false,
        })
        await expect(
            handlers.starAppHandler({ data: { appId: 'Not An App' } }),
        ).rejects.toThrow()
        expect(mocks.star).toHaveBeenCalledTimes(1)
    })

    it('stops before services when authentication fails', async () => {
        const error = new Error('Authentication required')
        mocks.requireAccess.mockRejectedValueOnce(error)
        await expect(
            handlers.followUserHandler({ data: { userId: targetId } }),
        ).rejects.toBe(error)
        expect(mocks.follow).not.toHaveBeenCalled()
    })
})
