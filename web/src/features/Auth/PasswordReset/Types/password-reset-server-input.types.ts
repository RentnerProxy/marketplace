import type { z } from 'zod'
import type { updatePasswordByTokenInputSchema } from '../validation.ts'

export type UpdatePasswordByTokenInput = z.infer<
    typeof updatePasswordByTokenInputSchema
>
