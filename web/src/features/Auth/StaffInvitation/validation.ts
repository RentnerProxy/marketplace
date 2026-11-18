import { z } from 'zod'
import { authNewPasswordSchema } from '@/lib/Auth/validation.ts'
import { STAFF_INVITATION_TOKEN_PATTERN } from '@/lib/Auth/staffInvitationToken.ts'

export const acceptStaffInvitationInputSchema = z.object({
    token: z.string().length(43).regex(STAFF_INVITATION_TOKEN_PATTERN),
    password: authNewPasswordSchema,
})
