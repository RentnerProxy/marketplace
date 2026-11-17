import { randomBytes } from 'node:crypto'
import { and, asc, eq, gt, lte } from 'drizzle-orm'
import { db } from '@/db'
import { staffInvitations, users } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { userInvitationConfig } from '@/config/session.config.ts'
import type { InviteStaffInput } from '@/features/Admin/StaffManagement/Types/staff-invitation.types.ts'
import { STAFF_INVITATION_PATH } from '@/lib/Auth/staffInvitationToken.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'
import {
    requireSuperUserReadAccessService,
    resolvePermissionSelectionInTransaction,
} from '@/server/Admin/PermissionManagement/permission-management-policy.service.ts'
import {
    accountIdentityMatchesService,
    hasStaffIdentityReservationInTransactionService,
    lockAccountUniquenessInTransactionService,
} from '@/server/Auth/accountUniqueness.service.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enqueuePasswordSetupMail } from '@/server/Queues/mail.queue.ts'

export async function getStaffInvitationsService(actorUserId: string) {
    await requireSuperUserReadAccessService(actorUserId)
    const rows = await db
        .select({
            id: staffInvitations.id,
            username: staffInvitations.username,
            email: staffInvitations.email,
            expiresAt: staffInvitations.expiresAt,
        })
        .from(staffInvitations)
        .where(gt(staffInvitations.expiresAt, new Date()))
        .orderBy(asc(staffInvitations.expiresAt))

    return rows.map(({ id, username, email, expiresAt }) => ({
        id,
        username,
        email,
        expiresAt: expiresAt.toISOString(),
    }))
}

export async function inviteStaffService(
    input: InviteStaffInput,
    actorUserId: string,
) {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = await createTokenHash(token)
    const url = new URL(
        STAFF_INVITATION_PATH,
        process.env.ORIGIN ?? 'http://localhost:3000',
    )
    url.hash = `invite=${token}`
    const auditContext = prepareAuditContextService(actorUserId)
    const staged = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        await requireMutationPermissionService(
            transaction,
            actorUserId,
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        const now = new Date()
        await transaction
            .delete(staffInvitations)
            .where(lte(staffInvitations.expiresAt, now))

        const existingUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.isDeleted, false),
                    accountIdentityMatchesService(input),
                ),
            )
            .limit(1)
        if (
            existingUsers.length > 0 ||
            (await hasStaffIdentityReservationInTransactionService(
                transaction,
                input,
                now,
            ))
        )
            return { success: false as const, error: 'identityInUse' as const }

        const selection = await resolvePermissionSelectionInTransaction(
            transaction,
            input.permissionKeys,
            { allowSuperUser: false },
        )
        if (
            !selection.success ||
            getDefaultRouteForPermissions(selection.permissionKeys) === '/login'
        )
            return {
                success: false as const,
                error: 'invalidPermissions' as const,
            }

        const invitationId = Bun.randomUUIDv7()
        await transaction.insert(staffInvitations).values({
            id: invitationId,
            username: input.username,
            email: input.email,
            invitedByUserId: actorUserId,
            expiresAt: new Date(
                now.getTime() + userInvitationConfig.durationMs,
            ),
            tokenHash,
            permissionKeys: selection.permissionKeys,
        })
        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.staff.invitation_created',
            message: 'Eine Teameinladung wurde erstellt.',
            newValues: {
                invitationId,
                email: input.email,
                permissionKeys: selection.permissionKeys,
            },
        })
        return { success: true as const, invitationId, audit }
    })
    if (!staged.success) return staged
    await publishCommittedAuditLogService(staged.audit)

    try {
        await enqueuePasswordSetupMail({
            to: input.email,
            username: input.username,
            resetLink: url.toString(),
        })
    } catch (error) {
        logError('admin.staff.invitation_enqueue_failed', error)
        await removeStaffInvitationService(
            staged.invitationId,
            actorUserId,
            'delivery_failed',
        )
        return { success: false as const, error: 'deliveryFailed' as const }
    }

    return { success: true as const }
}

async function removeStaffInvitationService(
    id: string,
    actorUserId: string,
    reason: 'revoked' | 'delivery_failed',
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const audit = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        if (reason === 'revoked')
            await requireMutationPermissionService(
                transaction,
                actorUserId,
                PERMISSIONS.ADMIN_SUPER_USER,
            )
        const deleted = await transaction
            .delete(staffInvitations)
            .where(eq(staffInvitations.id, id))
            .returning({ id: staffInvitations.id })
        if (deleted.length === 0) return null
        return writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: `admin.staff.invitation_${reason}`,
            message: 'Eine offene Teameinladung wurde entfernt.',
            oldValues: { invitationId: id },
        })
    })
    if (audit) await publishCommittedAuditLogService(audit)
}

export async function revokeStaffInvitationService(
    id: string,
    actorUserId: string,
) {
    await removeStaffInvitationService(id, actorUserId, 'revoked')
}
