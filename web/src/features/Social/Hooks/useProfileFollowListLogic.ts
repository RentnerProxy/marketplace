import { useInfiniteQuery } from '@tanstack/react-query'
import { profileFollowsQueryOptions } from '@/lib/Social/socialQueries.ts'
import type { ProfileFollowListLogicReturn } from '../Types/social-component.types.ts'
import type { ProfileFollowList } from '../Types/social.types.ts'

export default function useProfileFollowListLogic(
    username: string,
    list: ProfileFollowList,
): ProfileFollowListLogicReturn {
    const query = useInfiniteQuery(profileFollowsQueryOptions(username, list))

    function handleLoadMore() {
        void query.fetchNextPage()
    }

    return {
        state: {
            profiles:
                query.data?.pages.flatMap((page) => page?.profiles ?? []) ?? [],
            isLoading: query.isPending,
            hasMore: query.hasNextPage,
            isLoadingMore: query.isFetchingNextPage,
        },
        handler: { handleLoadMore },
    }
}
