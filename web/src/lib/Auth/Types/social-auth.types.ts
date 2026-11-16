export type SocialProviderId = 'google' | 'github' | 'discord'

export type SocialProvider = { id: SocialProviderId; name: string }

export type SocialIdentity = {
    provider: SocialProviderId
    subject: string
    email: string | null
    emailVerified: boolean
}

export type SocialRegistrationIdentity = SocialIdentity & { requestId: string }

export type SocialAuthState = {
    providers: SocialProvider[]
    registration: Omit<SocialIdentity, 'subject'> | null
    requiresTwoFactor: boolean
}
