import { createServerFn } from '@tanstack/react-start'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { acceptStaffInvitationService } from '@/server/Auth/StaffInvitation/accept.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { acceptStaffInvitationInputSchema } from './validation.ts'

export const acceptStaffInvitationHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => acceptStaffInvitationInputSchema.parse(data))
    .handler(async ({ data }) => {
        try {
            await enforceRateLimit({
                ...RATE_LIMITS.staffInvitationAccept,
                scope: 'staff-invitation-accept',
            })
            return await acceptStaffInvitationService(data)
        } catch (error) {
            logError('auth.staff_invitation_accept_failed', error)
            return { success: false as const, unavailable: true as const }
        }
    })
