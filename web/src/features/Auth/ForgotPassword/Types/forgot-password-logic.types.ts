import type { SubmitEvent } from 'react'
import type { AppForm } from '@/shared/Types/form.types.ts'
import type { RequestPasswordResetInput } from './forgot-password-server-input.types.ts'

export type PasswordForgotLogicReturn = {
    form: AppForm<RequestPasswordResetInput>
    state: { isLoading: boolean }
    handler: { handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void }
}
