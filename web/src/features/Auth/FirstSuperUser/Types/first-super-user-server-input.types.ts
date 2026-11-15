import type { z } from 'zod'
import type { createFirstSuperUserAccountInputSchema } from '../validation.ts'

export type CreateFirstSuperUserAccountInput = z.infer<
    typeof createFirstSuperUserAccountInputSchema
>
