import type { z } from 'zod'
import type {
    beginPasskeyLoginInputSchema,
    finishPasskeyLoginInputSchema,
    loginInputSchema,
} from '../validation.ts'

export type LoginInput = z.infer<typeof loginInputSchema>
export type BeginPasskeyLoginInput = z.infer<
    typeof beginPasskeyLoginInputSchema
>
export type FinishPasskeyLoginInput = z.infer<
    typeof finishPasskeyLoginInputSchema
>
