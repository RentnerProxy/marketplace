import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import type { CatalogApp } from '@/features/AppStore/Types/app-store.types.ts'

let catalog: Array<CatalogApp> | undefined
let isLoading = false
let isError = false
const refetch = vi.fn(async () => {})
let session: { user?: { id: string } } | undefined

vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: { queryKey: ReadonlyArray<string> }) =>
        options.queryKey[0] === 'auth'
            ? { data: session }
            : { data: catalog, isLoading, isError, refetch },
}))
vi.mock('@/lib/AppStore/appStoreQueries.ts', () => ({
    publishedAppsQueryOptions: () => ({ queryKey: ['app-store', 'published'] }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['auth', 'session'] }),
}))

const { default: useAppCatalogLogic } =
    await import('@/features/AppCatalog/Hooks/useAppCatalogLogic.ts')

function app(overrides: Partial<CatalogApp>): CatalogApp {
    return {
        appId: 'rentner.alpha',
        name: 'Alpha',
        summary: 'First app',
        license: 'MIT',
        version: '1.0.0',
        publishedAt: '2026-10-01T00:00:00.000Z',
        logoSrc: null,
        starCount: 0,
        isStarred: false,
        publisher: 'kevin',
        ...overrides,
    }
}

const apps = [
    app({}),
    app({
        appId: 'rentner.beta',
        name: 'Beta',
        summary: 'Weather widget',
        publishedAt: '2026-11-01T00:00:00.000Z',
        starCount: 2,
        isStarred: true,
        publisher: 'ada',
    }),
    app({
        appId: 'tools.gamma',
        name: 'Gamma',
        publishedAt: '2026-09-01T00:00:00.000Z',
        starCount: 9,
        publisher: null,
    }),
]

function names(logic: ReturnType<typeof useAppCatalogLogic>) {
    return logic.state.apps.map((entry) => entry.name)
}

beforeEach(() => {
    resetHooks()
    catalog = apps
    isLoading = false
    isError = false
    refetch.mockClear()
    session = { user: { id: 'viewer' } }
})

describe('app catalog logic', () => {
    it('lists the newest apps first and counts all apps', () => {
        const logic = renderHook(useAppCatalogLogic)
        expect(names(logic)).toEqual(['Beta', 'Alpha', 'Gamma'])
        expect(logic.state.totalCount).toBe(3)
        expect(logic.state.isSignedIn).toBe(true)
    })

    it('sorts by stars or name and ignores unknown sorts', () => {
        renderHook(useAppCatalogLogic).handler.handleSortChange('stars')
        expect(names(renderHook(useAppCatalogLogic))).toEqual([
            'Gamma',
            'Beta',
            'Alpha',
        ])
        renderHook(useAppCatalogLogic).handler.handleSortChange('name')
        expect(names(renderHook(useAppCatalogLogic))).toEqual([
            'Alpha',
            'Beta',
            'Gamma',
        ])
        renderHook(useAppCatalogLogic).handler.handleSortChange('popular')
        expect(renderHook(useAppCatalogLogic).state.sort).toBe('name')
    })

    it('searches name, summary, app id and publisher case-insensitively', () => {
        renderHook(useAppCatalogLogic).handler.handleQueryChange('WEATHER')
        expect(names(renderHook(useAppCatalogLogic))).toEqual(['Beta'])
        renderHook(useAppCatalogLogic).handler.handleQueryChange(' tools. ')
        expect(names(renderHook(useAppCatalogLogic))).toEqual(['Gamma'])
        renderHook(useAppCatalogLogic).handler.handleQueryChange('kevin')
        expect(names(renderHook(useAppCatalogLogic))).toEqual(['Alpha'])
        renderHook(useAppCatalogLogic).handler.handleQueryChange(
            'x'.repeat(200),
        )
        expect(renderHook(useAppCatalogLogic).state.query).toHaveLength(80)
    })

    it('filters own stars and resets all filters', () => {
        const logic = renderHook(useAppCatalogLogic)
        logic.handler.handleToggleStarredOnly()
        logic.handler.handleQueryChange('nothing matches')
        expect(renderHook(useAppCatalogLogic).state.apps).toEqual([])
        renderHook(useAppCatalogLogic).handler.handleQueryChange('')
        expect(names(renderHook(useAppCatalogLogic))).toEqual(['Beta'])
        renderHook(useAppCatalogLogic).handler.handleResetFilters()
        const reset = renderHook(useAppCatalogLogic)
        expect(reset.state.starredOnly).toBe(false)
        expect(names(reset)).toHaveLength(3)
    })

    it('never applies the star filter for anonymous visitors', () => {
        renderHook(useAppCatalogLogic).handler.handleToggleStarredOnly()
        expect(names(renderHook(useAppCatalogLogic))).toEqual(['Beta'])
        session = undefined
        const logic = renderHook(useAppCatalogLogic)
        expect(logic.state.isSignedIn).toBe(false)
        expect(logic.state.starredOnly).toBe(false)
        expect(names(logic)).toEqual(['Beta', 'Alpha', 'Gamma'])
    })

    it('reports failures only without earlier data and retries on request', () => {
        isError = true
        expect(renderHook(useAppCatalogLogic).state.isError).toBe(false)
        catalog = []
        expect(renderHook(useAppCatalogLogic).state.isError).toBe(false)
        catalog = undefined
        const failed = renderHook(useAppCatalogLogic)
        expect(failed.state.isError).toBe(true)
        failed.handler.handleRetry()
        expect(refetch).toHaveBeenCalledTimes(1)
    })

    it('keeps an empty list while the catalog loads', () => {
        catalog = undefined
        isLoading = true
        const logic = renderHook(useAppCatalogLogic)
        expect(logic.state).toMatchObject({
            apps: [],
            totalCount: 0,
            isLoading: true,
        })
    })
})
