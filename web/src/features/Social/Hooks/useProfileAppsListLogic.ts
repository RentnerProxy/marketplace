import { useQuery } from '@tanstack/react-query'
import { profileAppsQueryOptions } from '@/lib/Social/socialQueries.ts'
import type { ProfileAppsListLogicReturn } from '../Types/social-component.types.ts'

export default function useProfileAppsListLogic(
    username: string,
): ProfileAppsListLogicReturn {
    const { data, isLoading } = useQuery({
        ...profileAppsQueryOptions(username),
        enabled: Boolean(username),
    })

    return {
        state: {
            apps: data ?? [],
            isLoading: isLoading || !username,
        },
    }
}
