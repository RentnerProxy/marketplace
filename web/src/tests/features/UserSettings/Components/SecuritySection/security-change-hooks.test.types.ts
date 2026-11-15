import type { EffectCallback } from 'react'
import type {
    MutationObserver,
    MutationObserverOptions,
} from '@tanstack/react-query'

export type SecurityHookMutationResult =
    | { success: false; error: string; restartSetup?: boolean }
    | {
          success: true
          setupToken?: string
          secret?: string
          otpAuthUrl?: string
      }

export type SecurityHookMutationOptions = MutationObserverOptions<
    SecurityHookMutationResult,
    Error,
    unknown
>
export type SecurityHookMutationObserver = MutationObserver<
    SecurityHookMutationResult,
    Error,
    unknown
>

export type SecurityHookEffect = {
    dependencies: ReadonlyArray<unknown> | undefined
    pending: EffectCallback | undefined
    cleanup: (() => void) | undefined
}

export type SecurityHookQueryOptions = {
    queryKey: ReadonlyArray<unknown>
    enabled?: boolean
}
