import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { staffInvitations, users } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { userInvitationConfig } from '@/config/session.config.ts'
import type {
    InviteStaffInput,
    StaffInvitationSummary,
} from '@/features/Admin/StaffManagement/Types/staff-invitation.types.ts'
import { STAFF_INVITATION_PATH } from '@/lib/Auth/staffInvitationToken.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
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
    lockAccountUniquenessInTransactionService,
    staffInvitationIdentityMatchesService,
} from '@/server/Auth/accountUniqueness.service.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enqueuePasswordSetupMail } from '@/server/Queues/mail.queue.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import { publishPermissionManagementUpdatedService } from '@/server/Realtime/publish.service.ts'

export async function getStaffInvitationsService(
    actorUserId: string,
): Promise<Array<StaffInvitationSummary>> {
    await requireSuperUserReadAccessService(actorUserId)
    const now = Date.now()
    const rows = await db
        .select({
            id: staffInvitations.id,
            username: staffInvitations.username,
            email: staffInvitations.email,
            expiresAt: staffInvitations.expiresAt,
            isActive: staffInvitations.isActive,
            permissionKeys: staffInvitations.permissionKeys,
        })
        .from(staffInvitations)
        .orderBy(desc(staffInvitations.expiresAt), desc(staffInvitations.id))

    return rows.map(
        ({ id, username, email, permissionKeys, isActive, expiresAt }) => ({
            id,
            username,
            email,
            permissionKeys,
            expiresAt: expiresAt.toISOString(),
            status: !isActive
                ? 'disabled'
                : expiresAt.getTime() <= now
                  ? 'expired'
                  : 'active',
        }),
    )
}

export async function lockStaffInvitationMutationService(
    transaction: DatabaseTransaction,
    actorUserId: string,
) {
    await lockAccountUniquenessInTransactionService(transaction)
    await requireMutationPermissionService(
        transaction,
        actorUserId,
        PERMISSIONS.ADMIN_SUPER_USER,
    )
}

export async function hasAccountForStaffInvitationService(
    transaction: DatabaseTransaction,
    input: Pick<InviteStaffInput, 'email' | 'username'>,
) {
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
    return existingUsers.length > 0
}

export async function resolveStaffInvitationPermissionKeysService(
    transaction: DatabaseTransaction,
    permissionKeys: Array<string>,
) {
    const selection = await resolvePermissionSelectionInTransaction(
        transaction,
        permissionKeys,
        { allowSuperUser: false },
    )
    return selection.success &&
        getDefaultRouteForPermissions(selection.permissionKeys) !== '/login'
        ? selection.permissionKeys
        : null
}

export async function createStaffInvitationLinkService() {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = await createTokenHash(token)
    const url = new URL(
        STAFF_INVITATION_PATH,
        process.env.ORIGIN ?? 'http://localhost:3000',
    )
    url.hash = `invite=${token}`
    return { tokenHash, resetLink: url.toString() }
}

export function getStaffInvitationExpiryService() {
    return new Date(Date.now() + userInvitationConfig.durationMs)
}

export async function publishStaffInvitationsChangedService() {
    await runBestEffortSideEffectService(
        'admin.staff.invitation_publish_failed',
        () =>
            publishPermissionManagementUpdatedService({
                scope: 'staff-invitations',
                updatedAt: new Date().toISOString(),
            }),
    )
}

export async function inviteStaffService(
    input: InviteStaffInput,
    actorUserId: string,
) {
    const { tokenHash, resetLink } = await createStaffInvitationLinkService()
    const auditContext = prepareAuditContextService(actorUserId)
    const staged = await db.transaction(async (transaction) => {
        await lockStaffInvitationMutationService(transaction, actorUserId)
        if (await hasAccountForStaffInvitationService(transaction, input))
            return { success: false as const, error: 'identityInUse' as const }

        const existingInvitations = await transaction
            .select({ id: staffInvitations.id })
            .from(staffInvitations)
            .where(staffInvitationIdentityMatchesService(input))
            .limit(1)
        if (existingInvitations.length > 0)
            return {
                success: false as const,
                error: 'invitationExists' as const,
            }

        const permissionKeys =
            await resolveStaffInvitationPermissionKeysService(
                transaction,
                input.permissionKeys,
            )
        if (!permissionKeys)
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
            expiresAt: getStaffInvitationExpiryService(),
            tokenHash,
            permissionKeys,
        })
        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.staff.invitation_created',
            message: 'Eine Teameinladung wurde erstellt.',
            newValues: {
                invitationId,
                email: input.email,
                permissionKeys,
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
            resetLink,
        })
    } catch (error) {
        logError('admin.staff.invitation_enqueue_failed', error)
        await cleanUpFailedStaffInvitationService(
            staged.invitationId,
            tokenHash,
            actorUserId,
        )
        return { success: false as const, error: 'deliveryFailed' as const }
    }

    await publishStaffInvitationsChangedService()
    return { success: true as const }
}

async function cleanUpFailedStaffInvitationService(
    id: string,
    tokenHash: string,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const audit = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        const deleted = await transaction
            .delete(staffInvitations)
            .where(
                and(
                    eq(staffInvitations.id, id),
                    eq(staffInvitations.tokenHash, tokenHash),
                ),
            )
            .returning({ id: staffInvitations.id })
        if (deleted.length === 0) return null
        return writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.staff.invitation_delivery_failed',
            message:
                'Eine Teameinladung konnte nicht zum Versand eingeplant werden.',
            oldValues: { invitationId: id },
        })
    })
    if (audit) {
        await publishCommittedAuditLogService(audit)
        await publishStaffInvitationsChangedService()
    }
}
