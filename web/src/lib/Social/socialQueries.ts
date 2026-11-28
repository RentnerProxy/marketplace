import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import {
    getProfileAppsHandler,
    getProfileFollowsHandler,
    getPublicProfileHandler,
    searchProfilesHandler,
} from '@/features/Social/middleware.ts'
import type { ProfileFollowList } from '@/features/Social/Types/social.types.ts'

export const SOCIAL_QUERY_KEY = ['social'] as const

export function publicProfileQueryOptions(username: string) {
    return queryOptions({
        queryKey: [...SOCIAL_QUERY_KEY, 'profile', username] as const,
        queryFn: function ({ signal }) {
            return getPublicProfileHandler({ data: { username }, signal })
        },
    })
}

export function profileFollowsQueryOptions(
    username: string,
    list: ProfileFollowList,
) {
    return infiniteQueryOptions({
        queryKey: [...SOCIAL_QUERY_KEY, 'follows', username, list] as const,
        initialPageParam: 0,
        queryFn: function ({ pageParam, signal }) {
            return getProfileFollowsHandler({
                data: { username, list, offset: pageParam },
                signal,
            })
        },
        getNextPageParam: (page) => page?.nextOffset ?? undefined,
    })
}

export function searchProfilesQueryOptions(query: string) {
    return queryOptions({
        queryKey: [...SOCIAL_QUERY_KEY, 'search', query] as const,
        queryFn: function ({ signal }) {
            return searchProfilesHandler({ data: { query }, signal })
        },
    })
}

export function profileAppsQueryOptions(username: string) {
    return queryOptions({
        queryKey: [...SOCIAL_QUERY_KEY, 'apps', username] as const,
        queryFn: function ({ signal }) {
            return getProfileAppsHandler({ data: { username }, signal })
        },
    })
}
