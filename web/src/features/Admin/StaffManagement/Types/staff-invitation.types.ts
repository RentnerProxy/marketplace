import type { z } from 'zod'
import type {
    inviteStaffInputSchema,
    manageStaffInvitationInputSchema,
} from '../validation.ts'

export type InviteStaffInput = z.infer<typeof inviteStaffInputSchema>
export type ManageStaffInvitationInput = z.infer<
    typeof manageStaffInvitationInputSchema
>

export type StaffInvitationSummary = {
    id: string
    username: string
    email: string
    expiresAt: string
    status: 'active' | 'disabled' | 'expired'
    permissionKeys: Array<string>
}
