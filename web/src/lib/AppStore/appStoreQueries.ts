import { queryOptions } from '@tanstack/react-query'
import {
    getAppDetailHandler,
    getStoreEntryEditorHandler,
    listEditableStoreAppsHandler,
    listPublishedAppsHandler,
} from '@/features/AppStore/middleware.ts'

export const APP_STORE_QUERY_KEY = ['app-store'] as const

export function appDetailQueryOptions(appId: string) {
    return queryOptions({
        queryKey: [...APP_STORE_QUERY_KEY, 'detail', appId] as const,
        queryFn: function ({ signal }) {
            return getAppDetailHandler({ data: { appId }, signal })
        },
    })
}

export function publishedAppsQueryOptions() {
    return queryOptions({
        queryKey: [...APP_STORE_QUERY_KEY, 'published'] as const,
        queryFn: function ({ signal }) {
            return listPublishedAppsHandler({ signal })
        },
    })
}

export function storeEntryEditorQueryOptions(appId: string) {
    return queryOptions({
        queryKey: [...APP_STORE_QUERY_KEY, 'editor', appId] as const,
        queryFn: function ({ signal }) {
            return getStoreEntryEditorHandler({ data: { appId }, signal })
        },
    })
}

export function editableStoreAppsQueryOptions() {
    return queryOptions({
        queryKey: [...APP_STORE_QUERY_KEY, 'editable'] as const,
        queryFn: function ({ signal }) {
            return listEditableStoreAppsHandler({ signal })
        },
    })
}
