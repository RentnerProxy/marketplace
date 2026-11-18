import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { staffInvitations } from '@/db/schema.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enqueueStaffInvitationResendMail } from '@/server/Queues/mail.queue.ts'
import type { StaffInvitationResendMailInput } from '@/server/Queues/Types/mail-job.types.ts'
import {
    createStaffInvitationLinkService,
    getStaffInvitationAuditValues,
    getStaffInvitationExpiryService,
    lockStaffInvitationByIdService,
    lockStaffInvitationMutationService,
    publishStaffInvitationsChangedService,
    validateStaffInvitationAccessService,
} from './invitations.service.ts'

export async function requestStaffInvitationResendService(
    invitationId: string,
    actorUserId: string,
) {
    const staged = await db.transaction(async (transaction) => {
        await lockStaffInvitationMutationService(transaction, actorUserId)
        const invitation = await lockStaffInvitationByIdService(
            transaction,
            invitationId,
        )
        if (!invitation)
            return { success: false as const, error: 'notFound' as const }
        const validation = await validateStaffInvitationAccessService(
            transaction,
            invitation,
        )
        if (!validation.success) return validation
        return { success: true as const, invitation }
    })
    if (!staged.success) return staged

    const link = await createStaffInvitationLinkService()
    try {
        await enqueueStaffInvitationResendMail({
            invitationId,
            actorUserId,
            previousStatusRevision: staged.invitation.statusRevision,
            statusRevision: Bun.randomUUIDv7(),
            ...link,
        })
    } catch (error) {
        logError('admin.staff.invitation_enqueue_failed', error)
        return { success: false as const, error: 'deliveryFailed' as const }
    }
    return { success: true as const }
}

export async function prepareStaffInvitationResendMailService(
    job: StaffInvitationResendMailInput,
) {
    const result = await db
        .transaction(async (transaction) => {
            await lockStaffInvitationMutationService(
                transaction,
                job.actorUserId,
            )
            const invitation = await lockStaffInvitationByIdService(
                transaction,
                job.invitationId,
            )
            if (!invitation) return null

            const alreadyRotated =
                invitation.statusRevision === job.statusRevision
            if (alreadyRotated) {
                if (
                    !invitation.isActive ||
                    invitation.tokenHash !== job.tokenHash ||
                    invitation.invitedByUserId !== job.actorUserId ||
                    invitation.expiresAt.getTime() <= Date.now()
                )
                    return null
            } else if (
                invitation.statusRevision !== job.previousStatusRevision
            ) {
                return null
            }

            const validation = await validateStaffInvitationAccessService(
                transaction,
                invitation,
            )
            if (!validation.success) return null
            const mail = {
                to: invitation.email,
                username: invitation.username,
                resetLink: job.resetLink,
            }

            // A retry after a successful rotation sends the same link and preserves its expiry.
            if (alreadyRotated) return { mail, audit: null }

            const changes = {
                expiresAt: getStaffInvitationExpiryService(),
                permissionKeys: validation.permissionKeys,
                isActive: true,
                invitedByUserId: job.actorUserId,
                statusRevision: job.statusRevision,
            }
            await transaction
                .update(staffInvitations)
                .set({ ...changes, tokenHash: job.tokenHash })
                .where(eq(staffInvitations.id, job.invitationId))
            const oldValues = getStaffInvitationAuditValues(invitation)
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...prepareAuditContextService(job.actorUserId, {
                    route: '/admin/staff-invitations',
                }),
                action: 'admin.staff.invitation_resent',
                message:
                    'Ein neuer Link für eine Teameinladung wurde erstellt.',
                oldValues,
                newValues: getStaffInvitationAuditValues({
                    ...invitation,
                    ...changes,
                }),
            })
            return { mail, audit }
        })
        .catch((error: unknown) => {
            if (error instanceof PermissionDeniedError) return null
            throw error
        })

    if (!result) return null
    if (result.audit) {
        await publishCommittedAuditLogService(result.audit)
        await publishStaffInvitationsChangedService()
    }
    return result.mail
}
