import { beforeEach, describe, expect, it, vi } from 'bun:test'

const queryResults = new Map<string, unknown>()

vi.mock('@tanstack/react-query', () => ({
    queryOptions: (options: unknown) => options,
    useQuery: (options: { queryKey: ReadonlyArray<unknown> }) => ({
        data: queryResults.get(String(options.queryKey[1])),
    }),
}))
vi.mock('@/lib/AppStore/appStoreQueries.ts', () => ({
    publishedAppsQueryOptions: () => ({
        queryKey: ['app-store', 'published'],
    }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['auth', 'session'] }),
}))

const { default: usePublishedAppsLogic } =
    await import('@/features/MarketplaceApps/Hooks/usePublishedAppsLogic.ts')

beforeEach(() => {
    queryResults.clear()
})

describe('published apps logic', () => {
    it('defaults to an empty catalog for signed-out visitors', () => {
        expect(usePublishedAppsLogic().state).toEqual({
            apps: [],
            isSignedIn: false,
        })
    })

    it('returns the published apps and the sign-in state', () => {
        const apps = [{ appId: 'rentner.weather-widget' }] as never
        queryResults.set('published', apps)
        queryResults.set('session', { user: { id: 'viewer' } })
        expect(usePublishedAppsLogic().state).toEqual({
            apps,
            isSignedIn: true,
        })
    })
})
