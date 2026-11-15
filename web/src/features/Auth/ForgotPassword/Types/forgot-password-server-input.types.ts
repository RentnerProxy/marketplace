import type { z } from 'zod'
import type { requestPasswordResetInputSchema } from '../validation.ts'

export type RequestPasswordResetInput = z.infer<
    typeof requestPasswordResetInputSchema
>
