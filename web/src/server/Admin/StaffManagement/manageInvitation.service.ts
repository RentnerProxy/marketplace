import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { staffInvitations } from '@/db/schema.ts'
import type { ManageStaffInvitationInput } from '@/features/Admin/StaffManagement/Types/staff-invitation.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enqueuePasswordSetupMail } from '@/server/Queues/mail.queue.ts'
import {
    createStaffInvitationLinkService,
    getStaffInvitationExpiryService,
    hasAccountForStaffInvitationService,
    lockStaffInvitationMutationService,
    publishStaffInvitationsChangedService,
    resolveStaffInvitationPermissionKeysService,
} from './invitations.service.ts'

const invitationAuditActions = {
    revoke: [
        'admin.staff.invitation_revoked',
        'Eine Teameinladung wurde zurückgezogen.',
    ],
    resend: [
        'admin.staff.invitation_resent',
        'Eine Teameinladung wurde erneut zum Versand eingeplant.',
    ],
    setActive: [
        'admin.staff.invitation_status_changed',
        'Der Status einer Teameinladung wurde geändert.',
    ],
    permissions: [
        'admin.staff.invitation_permissions_updated',
        'Die Rechte einer Teameinladung wurden geändert.',
    ],
} as const

class StaffInvitationDeliveryError extends Error {}

export async function manageStaffInvitationService(
    input: ManageStaffInvitationInput,
    actorUserId: string,
) {
    const rotation =
        input.action === 'resend'
            ? await createStaffInvitationLinkService()
            : null
    const auditContext = prepareAuditContextService(actorUserId)

    try {
        const result = await db.transaction(async (transaction) => {
            await lockStaffInvitationMutationService(transaction, actorUserId)
            const [invitation] = await transaction
                .select()
                .from(staffInvitations)
                .where(eq(staffInvitations.id, input.id))
                .limit(1)
                .for('update')
            if (!invitation)
                return { success: false as const, error: 'notFound' as const }

            const [action, message] = invitationAuditActions[input.action]
            const oldValues = {
                invitationId: invitation.id,
                expiresAt: invitation.expiresAt,
                permissionKeys: invitation.permissionKeys,
                isActive: invitation.isActive,
                invitedByUserId: invitation.invitedByUserId,
            }
            if (input.action === 'revoke') {
                await transaction
                    .delete(staffInvitations)
                    .where(eq(staffInvitations.id, input.id))
                const audit = await writeAuditLogInTransactionService(
                    transaction,
                    {
                        ...auditContext,
                        action,
                        message,
                        oldValues,
                    },
                )
                return { success: true as const, audit }
            }

            if (
                input.action === 'setActive' &&
                input.isActive === invitation.isActive
            ) {
                return { success: true as const, audit: null }
            }

            const restoresAccess =
                input.action === 'resend' ||
                (input.action === 'setActive' && input.isActive)
            if (restoresAccess) {
                if (!rotation && invitation.expiresAt.getTime() <= Date.now()) {
                    return {
                        success: false as const,
                        error: 'expired' as const,
                    }
                }
                if (
                    await hasAccountForStaffInvitationService(
                        transaction,
                        invitation,
                    )
                ) {
                    return {
                        success: false as const,
                        error: 'identityInUse' as const,
                    }
                }
            }

            const permissionKeys =
                input.action === 'permissions' || restoresAccess
                    ? await resolveStaffInvitationPermissionKeysService(
                          transaction,
                          input.action === 'permissions'
                              ? input.permissionKeys
                              : invitation.permissionKeys,
                      )
                    : invitation.permissionKeys
            if (!permissionKeys)
                return {
                    success: false as const,
                    error: 'invalidPermissions' as const,
                }

            const newValues = {
                invitationId: invitation.id,
                expiresAt: rotation
                    ? getStaffInvitationExpiryService()
                    : invitation.expiresAt,
                permissionKeys,
                isActive:
                    input.action === 'setActive'
                        ? input.isActive
                        : input.action === 'resend' || invitation.isActive,
                invitedByUserId: restoresAccess
                    ? actorUserId
                    : invitation.invitedByUserId,
            }
            await transaction
                .update(staffInvitations)
                .set({
                    expiresAt: newValues.expiresAt,
                    permissionKeys: newValues.permissionKeys,
                    isActive: newValues.isActive,
                    invitedByUserId: newValues.invitedByUserId,
                    ...(rotation ? { tokenHash: rotation.tokenHash } : {}),
                })
                .where(eq(staffInvitations.id, input.id))
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action,
                message,
                oldValues,
                newValues,
            })
            if (rotation) {
                // Keep the previous link usable when the bounded queue operation fails.
                try {
                    await enqueuePasswordSetupMail({
                        to: invitation.email,
                        username: invitation.username,
                        resetLink: rotation.resetLink,
                    })
                } catch (error) {
                    throw new StaffInvitationDeliveryError(
                        'Staff invitation enqueue failed',
                        { cause: error },
                    )
                }
            }
            return { success: true as const, audit }
        })

        if (!result.success) return result
        if (result.audit) {
            await publishCommittedAuditLogService(result.audit)
            await publishStaffInvitationsChangedService()
        }
        return { success: true as const }
    } catch (error) {
        if (!(error instanceof StaffInvitationDeliveryError)) throw error
        logError('admin.staff.invitation_enqueue_failed', error.cause)
        return { success: false as const, error: 'deliveryFailed' as const }
    }
}
