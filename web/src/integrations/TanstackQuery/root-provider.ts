import { QueryClient } from '@tanstack/react-query'
import { installAuthSecretMutationCleanup } from '@/lib/Queries/authSecretMutationCleanup.ts'

export function getContext() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                gcTime: 10 * 60_000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
            mutations: {
                retry: 0,
            },
        },
    })

    installAuthSecretMutationCleanup(queryClient)

    return {
        queryClient,
    }
}
