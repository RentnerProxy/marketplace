import type { SubmitEvent } from 'react'
import type { AppForm } from '@/shared/Types/form.types.ts'
import type { LoginFormValues } from './login-form.types.ts'
import type useTwoFactorLogin from '../Hooks/useTwoFactorLogin.ts'

type TwoFactorLogin = ReturnType<typeof useTwoFactorLogin>

export type LoginLogicReturn = {
    form: AppForm<LoginFormValues>
    state: TwoFactorLogin['state'] & {
        isLoading: boolean
        isPasskeyLoading: boolean
    }
    setter: TwoFactorLogin['setter']
    handler: Pick<
        TwoFactorLogin['handler'],
        | 'handleTwoFactorSubmit'
        | 'handleTwoFactorChange'
        | 'handleBackToLogin'
        | 'handleTwoFactorRef'
    > & {
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
        handlePasskeyLogin: () => void
    }
}

export type LoginHeaderLogicReturn = {
    state: {
        companyName: string
        logoSrc: string
        hasCustomLogo: boolean
    }
}
