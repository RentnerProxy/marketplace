import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type {
    ProfileApp,
    ProfileFollowsPage,
    ProfileSummary,
    PublicProfile,
} from '@/features/Social/Types/social.types.ts'

type HandlerInput = { data: Record<string, unknown>; signal: AbortSignal }

const summary: ProfileSummary = {
    id: '019f72d1-dc60-7040-bdac-9e201573f002',
    username: 'kevin',
    bio: null,
    isTeam: false,
    profileImageVersion: null,
    isFollowing: false,
    isSelf: false,
}
const publicProfile: PublicProfile = {
    ...summary,
    bannerVersion: null,
    followerCount: 21,
    followingCount: 3,
    appCount: 1,
    starCount: 4,
    joinedAt: '2026-01-15T00:00:00.000Z',
}
const apps: Array<ProfileApp> = [
    {
        appId: 'rentner.weather-widget',
        name: 'Wetter',
        summary: 'Zeigt das Wetter.',
        license: 'MIT',
        version: '1.0.0',
        publishedAt: '2026-11-01T00:00:00.000Z',
        logoSrc: null,
        starCount: 4,
        isStarred: false,
    },
]
const firstPage: ProfileFollowsPage = { profiles: [summary], nextOffset: 20 }
const lastPage: ProfileFollowsPage = {
    profiles: [{ ...summary, username: 'zoe' }],
    nextOffset: null,
}

const getPublicProfile = vi.fn(async (_input: HandlerInput) => publicProfile)
const getProfileFollows = vi.fn(async (input: HandlerInput) =>
    input.data.offset === 0 ? firstPage : lastPage,
)
const searchProfiles = vi.fn(async (_input: HandlerInput) => [summary])
const getProfileApps = vi.fn(async (_input: HandlerInput) => apps)

vi.mock('@/features/Social/middleware.ts', () => ({
    getPublicProfileHandler: getPublicProfile,
    getProfileFollowsHandler: getProfileFollows,
    searchProfilesHandler: searchProfiles,
    getProfileAppsHandler: getProfileApps,
}))

const {
    SOCIAL_QUERY_KEY,
    profileAppsQueryOptions,
    profileFollowsQueryOptions,
    publicProfileQueryOptions,
    searchProfilesQueryOptions,
} = await import('@/lib/Social/socialQueries.ts')

let client: QueryClient

function keyOf(options: { queryKey: ReadonlyArray<unknown> }): Array<unknown> {
    return [...options.queryKey]
}

beforeEach(() => {
    client = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    vi.clearAllMocks()
})

afterEach(() => {
    client.clear()
})

describe('social query options', () => {
    it('scopes every social query below the shared social key', () => {
        expect(keyOf(publicProfileQueryOptions('kevin'))).toEqual([
            ...SOCIAL_QUERY_KEY,
            'profile',
            'kevin',
        ])
        expect(keyOf(profileFollowsQueryOptions('kevin', 'following'))).toEqual(
            [...SOCIAL_QUERY_KEY, 'follows', 'kevin', 'following'],
        )
        expect(keyOf(searchProfilesQueryOptions('kev'))).toEqual([
            ...SOCIAL_QUERY_KEY,
            'search',
            'kev',
        ])
        expect(keyOf(profileAppsQueryOptions('kevin'))).toEqual([
            ...SOCIAL_QUERY_KEY,
            'apps',
            'kevin',
        ])
    })

    it('loads a public profile, its apps and search results with abortable requests', async () => {
        await expect(
            client.fetchQuery(publicProfileQueryOptions('kevin')),
        ).resolves.toBe(publicProfile)
        await expect(
            client.fetchQuery(profileAppsQueryOptions('kevin')),
        ).resolves.toBe(apps)
        await expect(
            client.fetchQuery(searchProfilesQueryOptions('kev')),
        ).resolves.toEqual([summary])

        expect(getPublicProfile.mock.calls[0]?.[0].data).toEqual({
            username: 'kevin',
        })
        expect(getProfileApps.mock.calls[0]?.[0].data).toEqual({
            username: 'kevin',
        })
        expect(searchProfiles.mock.calls[0]?.[0].data).toEqual({
            query: 'kev',
        })
        for (const handler of [
            getPublicProfile,
            getProfileApps,
            searchProfiles,
        ]) {
            expect(handler.mock.calls[0]?.[0].signal).toBeInstanceOf(
                AbortSignal,
            )
        }
    })

    it('pages through a follow list by offset until no further page exists', async () => {
        const options = profileFollowsQueryOptions('kevin', 'followers')
        const first = await client.fetchInfiniteQuery(options)
        expect(getProfileFollows.mock.calls[0]?.[0].data).toEqual({
            username: 'kevin',
            list: 'followers',
            offset: 0,
        })
        expect(first.pageParams).toEqual([0])

        const second = await client.fetchInfiniteQuery({
            ...options,
            pages: 2,
        })
        expect(getProfileFollows.mock.calls.at(-1)?.[0].data).toEqual({
            username: 'kevin',
            list: 'followers',
            offset: 20,
        })
        expect(second.pages).toEqual([firstPage, lastPage])
        expect(second.pageParams).toEqual([0, 20])
        expect(options.getNextPageParam(lastPage, [], 20, [])).toBeUndefined()
        expect(options.getNextPageParam(firstPage, [], 0, [])).toBe(20)
    })
})
