import { useQuery } from '@tanstack/react-query'
import { getSocialAuthStateHandler } from '@/features/Auth/Social/middleware.ts'

export default function useSocialAuthState() {
    return useQuery({
        queryKey: ['social-auth-state'],
        queryFn: () => getSocialAuthStateHandler(),
        enabled: typeof window !== 'undefined',
        meta: { discardAuthSecretsAfterSettled: true },
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
    })
}
