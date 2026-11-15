import { z } from 'zod'

export const coreErrorSchema = z
    .object({
        code: z.string().regex(/^[A-Z0-9_]{1,100}$/),
        message: z.string().min(1).max(2000),
    })
    .strict()
