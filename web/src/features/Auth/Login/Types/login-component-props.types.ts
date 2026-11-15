import type { LoginRedirectReason } from '@/lib/Routes/Types/route-redirect.types.ts'

import type { SubmitEvent } from 'react'

export type LoginPageProps = {
    redirectReason?: LoginRedirectReason
}

export type TwoFactorFormProps = {
    code: Array<string>
    isLoading: boolean
    isError: boolean
    onChange: (code: Array<string>) => void
    setRef: (element: HTMLInputElement | null) => void
    trustThisDevice: boolean
    onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
    onTrustThisDeviceChange: (value: boolean) => void
    onBackToLogin: () => void
}
