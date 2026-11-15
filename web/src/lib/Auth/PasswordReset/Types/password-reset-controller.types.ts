import type { PasswordResetFormValues } from '@/features/Auth/PasswordReset/Types/password-reset-form.types.ts'
import type { PasswordResetTokenTransfer } from './password-reset-token.types.ts'

export type PasswordResetClientPhase =
    | 'checking'
    | 'ready'
    | 'unavailable'
    | 'submitting'
    | 'missing'
    | 'invalid'
    | 'complete'

type PasswordResetClientError =
    | 'password-policy'
    | 'password-mismatch'
    | 'validation-unavailable'
    | 'update-unavailable'

export type PasswordResetControllerOptions = {
    validate: (token: string, signal: AbortSignal) => Promise<unknown>
    update: (
        input: { token: string; password: string },
        signal: AbortSignal,
    ) => Promise<unknown>
    onPhaseChange: (phase: PasswordResetClientPhase) => void
    clearInputs: () => void
    onError: (reason: PasswordResetClientError) => void
    onRejected: (reason: 'missing' | 'invalid') => void
    onSuccess: () => void
    requestTimeoutMs: number
    schedule: (callback: () => void, delayMs: number) => () => void
}

export type PasswordResetController = {
    receiveToken: (transfer: PasswordResetTokenTransfer) => void
    invalidate: () => void
    retryValidation: () => void
    submit: (values: PasswordResetFormValues) => Promise<void>
    dispose: () => void
}
