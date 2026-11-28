import { useQuery } from '@tanstack/react-query'
import { publishedAppsQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import type { PublishedAppsLogicReturn } from '../Types/marketplace-apps.types.ts'

export default function usePublishedAppsLogic(): PublishedAppsLogicReturn {
    const { data } = useQuery(publishedAppsQueryOptions())
    const { data: session } = useQuery(authenticatedSessionQueryOptions())

    return {
        state: {
            apps: data ?? [],
            isSignedIn: Boolean(session?.user),
        },
    }
}
