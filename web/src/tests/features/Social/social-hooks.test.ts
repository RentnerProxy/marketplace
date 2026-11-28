import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type {
    ProfileApp,
    ProfileSummary,
} from '@/features/Social/Types/social.types.ts'

const pending: Array<Promise<unknown>> = []
const queryResults = new Map<string, unknown>()
const queryCalls: Array<Record<string, unknown>> = []
const invalidate = vi.fn(async (_filters: unknown) => {})
const fetchNextPage = vi.fn(async () => {})
const navigate = vi.fn(async (_options: unknown) => {})
const success = vi.fn()
const failure = vi.fn()
const follow = vi.fn(async (_input: unknown) => ({
    success: true as const,
    isFollowing: true,
    followerCount: 1,
}))
const unfollow = vi.fn(async (_input: unknown) => ({
    success: true as const,
    isFollowing: false,
    followerCount: 0,
}))
const star = vi.fn(async (_input: unknown) => ({
    success: true as const,
    isStarred: true,
    starCount: 4,
}))
const unstar = vi.fn(async (_input: unknown) => ({
    success: true as const,
    isStarred: false,
    starCount: 3,
}))
let search: { tab?: string } = {}
let infiniteState: Record<string, unknown> = {}

vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    queryOptions: (options: unknown) => options,
    infiniteQueryOptions: (options: unknown) => options,
    useQuery: (
        options: { queryKey: ReadonlyArray<unknown> } & Record<string, unknown>,
    ) => {
        queryCalls.push(options)
        return {
            data: queryResults.get(String(options.queryKey[1])),
            isPending: true,
        }
    },
    useInfiniteQuery: () => ({ ...infiniteState, fetchNextPage }),
    useQueryClient: () => ({ invalidateQueries: invalidate }),
    useMutation: (options: {
        mutationFn: () => Promise<unknown>
        onSuccess?: (result: unknown) => unknown
        onError?: (error: unknown) => unknown
    }) => ({
        isPending: false,
        mutate() {
            pending.push(
                options
                    .mutationFn()
                    .then((result) => options.onSuccess?.(result))
                    .catch((error) => options.onError?.(error)),
            )
        },
    }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useSearch: () => search,
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success } }))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: failure }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
vi.mock('@/lib/AppStore/appStoreQueries.ts', () => ({
    APP_STORE_QUERY_KEY: ['app-store'],
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['auth', 'session'] }),
}))
vi.mock('@/features/Social/middleware.ts', () => ({
    followUserHandler: follow,
    unfollowUserHandler: unfollow,
    getPublicProfileHandler: vi.fn(),
    getProfileFollowsHandler: vi.fn(),
    searchProfilesHandler: vi.fn(),
    getProfileAppsHandler: vi.fn(),
    starAppHandler: star,
    unstarAppHandler: unstar,
}))

const { default: useFollowButtonLogic } =
    await import('@/features/Social/Hooks/useFollowButtonLogic.ts')
const { default: useProfileFollowListLogic } =
    await import('@/features/Social/Hooks/useProfileFollowListLogic.ts')
const { default: usePublicProfilePageLogic } =
    await import('@/features/PublicProfile/Hooks/usePublicProfilePageLogic.ts')
const { default: usePeopleSearchLogic } =
    await import('@/features/People/Hooks/usePeopleSearchLogic.ts')
const { default: useStarButtonLogic } =
    await import('@/features/Social/Hooks/useStarButtonLogic.ts')
const { default: useProfileAppsListLogic } =
    await import('@/features/Social/Hooks/useProfileAppsListLogic.ts')

const app: ProfileApp = {
    appId: 'rentner.weather-widget',
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.0.0',
    publishedAt: '2026-11-01T00:00:00.000Z',
    logoSrc: null,
    starCount: 3,
    isStarred: false,
}

const profile: ProfileSummary = {
    id: '019f72d1-dc60-7040-bdac-9e201573f002',
    username: 'kevin',
    bio: null,
    isTeam: false,
    profileImageVersion: null,
    isFollowing: false,
    isSelf: false,
}

async function settle() {
    await Promise.all(pending.splice(0))
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    queryResults.clear()
    queryCalls.length = 0
    search = {}
    infiniteState = {}
})
afterEach(restoreTestGlobals)

describe('follow button logic', () => {
    it('follows, confirms with a toast and refreshes social data', async () => {
        renderHook(() =>
            useFollowButtonLogic(profile),
        ).handler.handleToggleFollow()
        await settle()
        expect(follow).toHaveBeenCalledWith({ data: { userId: profile.id } })
        expect(success).toHaveBeenCalledWith(
            'social.followed{"username":"kevin"}',
            { title: 'social.title' },
        )
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['social'] })
    })

    it('unfollows a followed account and reports failures', async () => {
        renderHook(() =>
            useFollowButtonLogic({ ...profile, isFollowing: true }),
        ).handler.handleToggleFollow()
        await settle()
        expect(unfollow).toHaveBeenCalled()
        expect(success).toHaveBeenCalledWith(
            'social.unfollowed{"username":"kevin"}',
            { title: 'social.title' },
        )
        follow.mockResolvedValueOnce({
            success: false,
            error: 'Nope',
        } as never)
        renderHook(() =>
            useFollowButtonLogic(profile),
        ).handler.handleToggleFollow()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Nope' }),
        )
    })
})

describe('star button logic', () => {
    it('stars an app, confirms with a toast and refreshes social data', async () => {
        renderHook(() => useStarButtonLogic(app)).handler.handleToggleStar()
        await settle()
        expect(star).toHaveBeenCalledWith({ data: { appId: app.appId } })
        expect(success).toHaveBeenCalledWith(
            'social.starred{"name":"Wetter"}',
            {
                title: 'profile.stats.stars',
            },
        )
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['social'] })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['app-store'] })
    })

    it('removes a star and reports refused stars', async () => {
        renderHook(() =>
            useStarButtonLogic({ ...app, isStarred: true }),
        ).handler.handleToggleStar()
        await settle()
        expect(unstar).toHaveBeenCalledWith({ data: { appId: app.appId } })
        expect(success).toHaveBeenCalledWith(
            'social.unstarred{"name":"Wetter"}',
            { title: 'profile.stats.stars' },
        )
        star.mockResolvedValueOnce({ success: false, error: 'Nope' } as never)
        renderHook(() => useStarButtonLogic(app)).handler.handleToggleStar()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Nope' }),
        )
        expect(invalidate).toHaveBeenCalledTimes(2)
    })
})

describe('profile apps list logic', () => {
    it('loads the apps of a profile and waits for a username', () => {
        queryResults.set('apps', [app])
        const logic = renderHook(() => useProfileAppsListLogic('kevin'))
        expect(logic.state.apps).toEqual([app])
        expect(logic.state.isLoading).toBe(false)
        expect(queryCalls.at(-1)).toMatchObject({
            queryKey: ['social', 'apps', 'kevin'],
            enabled: true,
        })

        queryResults.clear()
        const waiting = renderHook(() => useProfileAppsListLogic(''))
        expect(waiting.state).toEqual({ apps: [], isLoading: true })
        expect(queryCalls.at(-1)).toMatchObject({ enabled: false })
    })
})

describe('follow list logic', () => {
    it('flattens pages and loads the next one', () => {
        infiniteState = {
            data: {
                pages: [{ profiles: [profile] }, null, { profiles: [profile] }],
            },
            isPending: false,
            hasNextPage: true,
            isFetchingNextPage: false,
        }
        const logic = renderHook(() =>
            useProfileFollowListLogic('kevin', 'followers'),
        )
        expect(logic.state.profiles).toHaveLength(2)
        expect(logic.state.hasMore).toBe(true)
        logic.handler.handleLoadMore()
        expect(fetchNextPage).toHaveBeenCalled()
        infiniteState = { isPending: true }
        expect(
            renderHook(() => useProfileFollowListLogic('kevin', 'following'))
                .state.profiles,
        ).toEqual([])
    })
})

describe('public profile page logic', () => {
    it('derives media, join date, sign-in state and tabs', () => {
        queryResults.set('profile', {
            ...profile,
            profileImageVersion: 9,
            bannerVersion: '2026-11-27T20:00:00.000Z',
            followerCount: 1,
            followingCount: 2,
            joinedAt: '2026-01-15T00:00:00.000Z',
        })
        queryResults.set('session', { user: { id: 'viewer' } })
        search = { tab: 'followers' }
        const logic = renderHook(() => usePublicProfilePageLogic('kevin'))
        expect(logic.state.activeTab).toBe('followers')
        expect(logic.state.isSignedIn).toBe(true)
        expect(logic.state.bannerSrc).toContain(
            `/api/profiles/${profile.id}/banner?v=`,
        )
        expect(logic.state.profileImageSrc).toContain('profile.webp?v=9')
        expect(logic.state.joinedLabel).toContain('2026')
        logic.handler.handleTabChange('following')
        expect(navigate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '/u/$username',
                params: { username: 'kevin' },
                search: { tab: 'following' },
            }),
        )
    })

    it('stays empty while the profile is unknown', () => {
        const logic = renderHook(() => usePublicProfilePageLogic('ghost'))
        expect(logic.state).toMatchObject({
            activeTab: 'apps',
            bannerSrc: null,
            isSignedIn: false,
            joinedLabel: '',
            profile: null,
        })
    })
})

describe('people search logic', () => {
    it('debounces input and only searches from two characters', () => {
        const timers: Array<() => void> = []
        stubTestGlobal('window', {
            setTimeout: (callback: () => void) => timers.push(callback),
            clearTimeout: vi.fn(),
        })
        let logic = renderHook(usePeopleSearchLogic)
        expect(logic.state.canSearch).toBe(false)
        logic.handler.handleQueryChange(' k')
        logic = renderHook(usePeopleSearchLogic)
        runEffects()
        timers.at(-1)?.()
        logic = renderHook(usePeopleSearchLogic)
        expect(logic.state.canSearch).toBe(false)
        logic.handler.handleQueryChange('kev ')
        renderHook(usePeopleSearchLogic)
        runEffects()
        timers.at(-1)?.()
        logic = renderHook(usePeopleSearchLogic)
        expect(logic.state).toMatchObject({
            searchedQuery: 'kev',
            canSearch: true,
            isSearching: true,
        })
        expect(queryCalls.at(-1)).toMatchObject({ enabled: true })
    })
})
