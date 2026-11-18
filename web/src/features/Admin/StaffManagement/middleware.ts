import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import {
    getStaffInvitationsService,
    inviteStaffService,
    revokeStaffInvitationService,
} from '@/server/Admin/StaffManagement/invitations.service.ts'
import {
    inviteStaffInputSchema,
    revokeStaffInvitationInputSchema,
} from './validation.ts'

export const getStaffInvitationsHandler = createServerFn({
    method: 'GET',
}).handler(async () => {
    const { userId } = await requirePermissionService(
        PERMISSIONS.ADMIN_SUPER_USER,
    )
    return getStaffInvitationsService(userId)
})

export const inviteStaffHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => inviteStaffInputSchema.parse(data))
    .handler(async ({ data }) => {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        await enforceRateLimit({
            ...RATE_LIMITS.staffInvitationSend,
            scope: 'staff-invitation-send',
            identifiers: [userId],
            includeClientIp: false,
        })
        return inviteStaffService(data, userId)
    })

export const revokeStaffInvitationHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => revokeStaffInvitationInputSchema.parse(data))
    .handler(async ({ data }) => {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        await revokeStaffInvitationService(data.id, userId)
        return { success: true as const }
    })
