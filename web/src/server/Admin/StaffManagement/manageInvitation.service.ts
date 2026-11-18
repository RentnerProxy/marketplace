import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { staffInvitations } from '@/db/schema.ts'
import type { ManageStaffInvitationInput } from '@/features/Admin/StaffManagement/Types/staff-invitation.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { haveSamePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import {
    getStaffInvitationAuditValues,
    lockStaffInvitationByIdService,
    lockStaffInvitationMutationService,
    publishStaffInvitationsChangedService,
    resolveStaffInvitationPermissionKeysService,
    validateStaffInvitationAccessService,
} from './invitations.service.ts'
import { requestStaffInvitationResendService } from './resendInvitation.service.ts'

const invitationAuditActions = {
    revoke: [
        'admin.staff.invitation_revoked',
        'Eine Teameinladung wurde zurückgezogen.',
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

export async function manageStaffInvitationService(
    input: ManageStaffInvitationInput,
    actorUserId: string,
) {
    if (input.action === 'resend') {
        return requestStaffInvitationResendService(input.id, actorUserId)
    }

    const auditContext = prepareAuditContextService(actorUserId)
    const result = await db.transaction(async (transaction) => {
        await lockStaffInvitationMutationService(transaction, actorUserId)
        const invitation = await lockStaffInvitationByIdService(
            transaction,
            input.id,
        )
        if (!invitation)
            return { success: false as const, error: 'notFound' as const }

        const [action, message] = invitationAuditActions[input.action]
        const oldValues = getStaffInvitationAuditValues(invitation)
        if (input.action === 'revoke') {
            await transaction
                .delete(staffInvitations)
                .where(eq(staffInvitations.id, input.id))
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action,
                message,
                oldValues,
            })
            return { success: true as const, audit }
        }

        const changes = {
            permissionKeys: invitation.permissionKeys,
            isActive: invitation.isActive,
            invitedByUserId: invitation.invitedByUserId,
            statusRevision: invitation.statusRevision,
        }
        if (input.action === 'permissions') {
            if (
                !haveSamePermissionKeys(
                    input.expectedPermissionKeys,
                    invitation.permissionKeys,
                )
            ) {
                return {
                    success: false as const,
                    error: 'permissionConflict' as const,
                    currentPermissionKeys: invitation.permissionKeys,
                }
            }
            const permissionKeys =
                await resolveStaffInvitationPermissionKeysService(
                    transaction,
                    input.permissionKeys,
                )
            if (!permissionKeys) {
                return {
                    success: false as const,
                    error: 'invalidPermissions' as const,
                }
            }
            changes.permissionKeys = permissionKeys
        } else {
            if (
                input.isActive &&
                invitation.expiresAt.getTime() <= Date.now()
            ) {
                return { success: false as const, error: 'expired' as const }
            }
            if (input.isActive === invitation.isActive) {
                if (!input.isActive) {
                    // Invalidate resends staged before this explicit deactivation.
                    await transaction
                        .update(staffInvitations)
                        .set({ statusRevision: Bun.randomUUIDv7() })
                        .where(eq(staffInvitations.id, input.id))
                }
                return { success: true as const, audit: null }
            }
            if (input.isActive) {
                const validation = await validateStaffInvitationAccessService(
                    transaction,
                    invitation,
                )
                if (!validation.success) return validation
                changes.permissionKeys = validation.permissionKeys
                changes.invitedByUserId = actorUserId
            }
            changes.isActive = input.isActive
            changes.statusRevision = Bun.randomUUIDv7()
        }

        await transaction
            .update(staffInvitations)
            .set(changes)
            .where(eq(staffInvitations.id, input.id))
        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action,
            message,
            oldValues,
            newValues: getStaffInvitationAuditValues({
                ...invitation,
                ...changes,
            }),
        })
        return { success: true as const, audit }
    })

    if (!result.success) return result
    if (result.audit) {
        await publishCommittedAuditLogService(result.audit)
        await publishStaffInvitationsChangedService()
    }
    return { success: true as const }
}
