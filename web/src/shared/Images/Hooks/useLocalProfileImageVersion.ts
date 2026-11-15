import { useQuery } from '@tanstack/react-query'
import { profileImageVersionQueryKey } from '@/lib/Queries/appQueries.ts'

export default function useLocalProfileImageVersion(
    userId: string | undefined,
    initialData: number | null,
) {
    const { data: localProfileImageVersion } = useQuery({
        queryKey: profileImageVersionQueryKey(userId),
        queryFn: function (): number | null {
            return null
        },
        enabled: Boolean(userId),
        initialData,
        staleTime: Infinity,
    })

    return localProfileImageVersion ?? null
}
