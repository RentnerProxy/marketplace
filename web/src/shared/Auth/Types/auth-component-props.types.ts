import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export type SocialProviderIconProps = {
    provider: SocialProviderId
}

export type AuthFormSubmitButtonProps = {
    isLoading: boolean
    loadingLabel: string
    label: string
}
