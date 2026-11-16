import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

export type SocialChallengePurpose =
    'authorization' | 'registration' | 'two_factor' | 'link_completion'

export type StoreSocialChallengeInput = {
    token: string
    browserToken: string
    provider: SocialProviderId
    purpose: SocialChallengePurpose
    payload: unknown
    durationMs: number
    transaction?: DatabaseTransaction
}
