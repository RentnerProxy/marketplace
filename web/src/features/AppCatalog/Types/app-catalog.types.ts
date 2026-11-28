import type { ReactNode } from 'react'
import type { APP_CATALOG_SORTS } from '@/config/app-catalog.config.ts'
import type { CatalogApp } from '@/features/AppStore/Types/app-store.types.ts'

export type AppCatalogSort = (typeof APP_CATALOG_SORTS)[number]

export type AppCatalogProps = {
    /** Heading above the toolbar; omitted when the page header already names it. */
    title?: string
    /** Render nothing while no app is published (public marketing page). */
    hideWhenEmpty?: boolean
    emptyState?: ReactNode
}

export type AppCatalogLogicReturn = {
    state: {
        apps: Array<CatalogApp>
        totalCount: number
        isLoading: boolean
        /** The request failed and no earlier catalog data is available. */
        isError: boolean
        isSignedIn: boolean
        query: string
        sort: AppCatalogSort
        starredOnly: boolean
    }
    handler: {
        handleQueryChange: (query: string) => void
        handleSortChange: (sort: string) => void
        handleToggleStarredOnly: () => void
        handleRetry: () => void
        handleResetFilters: () => void
    }
}

export type AppCatalogToolbarProps = {
    state: AppCatalogLogicReturn['state']
    handler: AppCatalogLogicReturn['handler']
}
