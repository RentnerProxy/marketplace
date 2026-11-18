import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import {
    getStaffInvitationsService,
    inviteStaffService,
} from '@/server/Admin/StaffManagement/invitations.service.ts'
import { manageStaffInvitationService } from '@/server/Admin/StaffManagement/manageInvitation.service.ts'
import {
    inviteStaffInputSchema,
    manageStaffInvitationInputSchema,
} from './validation.ts'

async function enforceStaffInvitationSendRateLimit(userId: string) {
    await enforceRateLimit({
        ...RATE_LIMITS.staffInvitationSend,
        scope: 'staff-invitation-send',
        identifiers: [userId],
        includeClientIp: false,
    })
}

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
        await enforceStaffInvitationSendRateLimit(userId)
        return inviteStaffService(data, userId)
    })

export const manageStaffInvitationHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => manageStaffInvitationInputSchema.parse(data))
    .handler(async ({ data }) => {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        if (data.action === 'resend')
            await enforceStaffInvitationSendRateLimit(userId)
        return manageStaffInvitationService(data, userId)
    })
