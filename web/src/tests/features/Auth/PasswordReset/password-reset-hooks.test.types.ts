import type { EffectCallback } from 'react'
import type { PasswordResetFormValues } from '@/features/Auth/PasswordReset/Types/password-reset-form.types.ts'

export type ResetHookEffect = {
    dependencies: ReadonlyArray<unknown> | undefined
    setup: EffectCallback
    pending: boolean
    cleanup: (() => void) | undefined
}
export type ResetHookFormOptions = {
    onSubmit: (input: { value: PasswordResetFormValues }) => Promise<void>
}
export type ResetHookServerCall = {
    data: { token: string; password?: string }
    signal: AbortSignal
}
