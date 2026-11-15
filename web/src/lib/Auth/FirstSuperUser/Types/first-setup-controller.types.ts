import type { FirstSuperUserFormValues } from '@/features/Auth/FirstSuperUser/Types/first-super-user-form.types.ts'
import type { CreateFirstSuperUserAccountInput } from '@/features/Auth/FirstSuperUser/Types/first-super-user-server-input.types.ts'
import type { FirstSetupTokenTransfer } from './first-setup-token.types.ts'

export type FirstSetupClientPhase =
    'checking' | 'granted' | 'missing' | 'submitting' | 'complete'

export type FirstSetupFormError =
    | 'password-policy'
    | 'password-mismatch'
    | 'email'
    | 'username'
    | 'invalid-data'

export type FirstSetupControllerOptions = {
    create: (
        input: CreateFirstSuperUserAccountInput,
        signal: AbortSignal,
    ) => Promise<unknown>
    onPhaseChange: (phase: FirstSetupClientPhase) => void
    clearPasswords: () => void
    onInvalidInput: (reason: FirstSetupFormError) => void
    onInvalidToken: () => void
    onError: (error: unknown) => void
    onComplete: (outcome: 'created' | 'already-completed') => void
    requestTimeoutMs: number
    schedule: (callback: () => void, delayMs: number) => () => void
}

export type FirstSetupController = {
    receiveToken: (transfer: FirstSetupTokenTransfer) => void
    invalidate: () => void
    submit: (values: FirstSuperUserFormValues) => Promise<void>
    dispose: () => void
}
