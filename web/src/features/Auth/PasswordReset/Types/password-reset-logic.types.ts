import type { SubmitEvent } from 'react'
import type { AppForm } from '@/shared/Types/form.types.ts'
import type { PasswordResetClientPhase } from '@/lib/Auth/PasswordReset/Types/password-reset-controller.types.ts'
import type { PasswordResetFormValues } from './password-reset-form.types.ts'

export type PasswordResetLogicReturn = {
    form: AppForm<PasswordResetFormValues>
    state: { phase: PasswordResetClientPhase; isLoading: boolean }
    handler: {
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
        handleRetryValidation: () => void
    }
}
