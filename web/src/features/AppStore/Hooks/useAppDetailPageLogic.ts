import { useQuery } from '@tanstack/react-query'
import { appDetailQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import type { AppDetailPageLogicReturn } from '../Types/app-store-component.types.ts'

export default function useAppDetailPageLogic(
    appId: string,
): AppDetailPageLogicReturn {
    const { data: app } = useQuery(appDetailQueryOptions(appId))
    const { data: session } = useQuery(authenticatedSessionQueryOptions())

    return {
        state: {
            app: app ?? null,
            isSignedIn: Boolean(session?.user),
        },
    }
}
