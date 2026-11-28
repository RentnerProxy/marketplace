import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
    APP_CATALOG_CONFIG,
    APP_CATALOG_SORTS,
} from '@/config/app-catalog.config.ts'
import type { CatalogApp } from '@/features/AppStore/Types/app-store.types.ts'
import { publishedAppsQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import type {
    AppCatalogLogicReturn,
    AppCatalogSort,
} from '../Types/app-catalog.types.ts'

function isCatalogSort(value: string): value is AppCatalogSort {
    return APP_CATALOG_SORTS.some((sort) => sort === value)
}

function matchesQuery(app: CatalogApp, query: string) {
    if (!query) return true
    return [app.name, app.summary, app.appId, app.publisher ?? '']
        .join('\n')
        .toLocaleLowerCase()
        .includes(query)
}

function compareApps(sort: AppCatalogSort) {
    return function (left: CatalogApp, right: CatalogApp) {
        if (sort === 'stars' && right.starCount !== left.starCount) {
            return right.starCount - left.starCount
        }
        if (sort === 'name') {
            return left.name.localeCompare(right.name)
        }
        return right.publishedAt.localeCompare(left.publishedAt)
    }
}

/** Search, sort and star filter over the published catalog. */
export default function useAppCatalogLogic(): AppCatalogLogicReturn {
    const { data, isLoading } = useQuery(publishedAppsQueryOptions())
    const { data: session } = useQuery(authenticatedSessionQueryOptions())
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<AppCatalogSort>(
        APP_CATALOG_CONFIG.defaultSort,
    )
    const [starredOnly, setStarredOnly] = useState(false)
    const isSignedIn = Boolean(session?.user)
    const allApps = data ?? []
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const apps = allApps
        .filter(
            (app) =>
                matchesQuery(app, normalizedQuery) &&
                (!starredOnly || app.isStarred),
        )
        .toSorted(compareApps(sort))

    return {
        state: {
            apps,
            totalCount: allApps.length,
            isLoading,
            isSignedIn,
            query,
            sort,
            starredOnly: isSignedIn && starredOnly,
        },
        handler: {
            handleQueryChange: (value) =>
                setQuery(value.slice(0, APP_CATALOG_CONFIG.searchMaxLength)),
            handleSortChange: (value) => {
                if (isCatalogSort(value)) setSort(value)
            },
            handleToggleStarredOnly: () => setStarredOnly((value) => !value),
            handleResetFilters: () => {
                setQuery('')
                setStarredOnly(false)
            },
        },
    }
}
