import type { z } from 'zod'
import type { inviteStaffInputSchema } from '../validation.ts'

export type InviteStaffInput = z.infer<typeof inviteStaffInputSchema>
