import { z } from 'zod'
import { authEmailSchema } from '@/lib/Auth/validation.ts'

export const requestPasswordResetInputSchema = z.object({
    email: authEmailSchema,
})
