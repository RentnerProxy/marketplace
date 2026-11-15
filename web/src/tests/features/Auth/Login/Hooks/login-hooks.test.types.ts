import type {
    MutationObserver,
    MutationObserverOptions,
} from '@tanstack/react-query'
import type { LoginFormValues } from '@/features/Auth/Login/Types/login-form.types.ts'

export type LoginHookFormOptions = {
    onSubmit: (input: { value: LoginFormValues }) => Promise<void>
}

export type LoginHookMutationResult =
    | {
          success: true
          user: { id: string; permissions: Array<string> }
          redirectTo: string
          loggedOutDueToMissingPermissions?: boolean
          error?: string
      }
    | { success: false; requiresTwoFactor?: boolean; error?: string }

export type LoginHookMutationOptions = MutationObserverOptions<
    LoginHookMutationResult,
    Error,
    unknown
>

export type LoginHookMutationObserver = MutationObserver<
    LoginHookMutationResult,
    Error,
    unknown
>
