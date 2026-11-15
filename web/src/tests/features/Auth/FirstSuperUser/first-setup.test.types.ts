import type { EffectCallback } from 'react'
import type { CreateFirstSuperUserAccountInput } from '@/features/Auth/FirstSuperUser/Types/first-super-user-server-input.types.ts'

export type FirstSetupHookEffect = {
    dependencies: ReadonlyArray<unknown> | undefined
    setup: EffectCallback
    pending: boolean
    cleanup: (() => void) | undefined
}

export type FirstSetupTestServerCall = {
    data: CreateFirstSuperUserAccountInput
    signal: AbortSignal
}
