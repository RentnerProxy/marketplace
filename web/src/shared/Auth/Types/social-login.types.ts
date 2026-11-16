import type { SubmitEvent } from 'react'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export type SocialLoginLogicReturn = {
    state: {
        providers: Array<{ id: SocialProviderId; name: string }>
        isPending: boolean
        requiresTwoFactor: boolean
        code: string
        error: string
    }
    handler: {
        handleBegin: (provider: SocialProviderId) => void
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
        handleCancel: () => void
    }
    setter: { setCode: (value: string) => void }
}
