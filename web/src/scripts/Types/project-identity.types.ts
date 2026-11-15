import type { z } from 'zod'
import { projectIdentitySchema } from '@/scripts/Project/identity-validation.ts'

export type ProjectIdentity = z.infer<typeof projectIdentitySchema>
