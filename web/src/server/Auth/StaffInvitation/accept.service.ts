import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import {
    staffAccounts,
    staffInvitations,
    staffUserPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import {
    getDefaultRouteForPermissions,
    hasSuperUserPermission,
} from '@/lib/Permissions/permissions.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { resolvePermissionSelectionInTransaction } from '@/server/Admin/PermissionManagement/permission-management-policy.service.ts'
import { publishStaffInvitationsChangedService } from '@/server/Admin/StaffManagement/invitations.service.ts'
import { getActiveUserPermissionKeysInTransaction } from '@/server/Auth/transaction-authorization.service.ts'
import { publishUserUpdatedService } from '@/server/Realtime/publish.service.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import {
    accountIdentityMatchesService,
    lockAccountUniquenessInTransactionService,
} from '@/server/Auth/accountUniqueness.service.ts'

export async function acceptStaffInvitationService(input: {
    token: string
    password: string
}) {
    const tokenHash = await createTokenHash(input.token)
    const passwordHash = await Bun.password.hash(input.password)
    const auditContext = prepareAuditContextService(null)
    const result = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        const rows = await transaction
            .select()
            .from(staffInvitations)
            .where(
                and(
                    eq(staffInvitations.tokenHash, tokenHash),
                    eq(staffInvitations.isActive, true),
                    gt(staffInvitations.expiresAt, new Date()),
                ),
            )
            .limit(1)
            .for('update')
        const invitation = rows.at(0)
        if (!invitation) return null

        await lockAuditUsersInTransactionService(transaction, [
            invitation.invitedByUserId,
        ])
        const inviterPermissions =
            await getActiveUserPermissionKeysInTransaction(
                transaction,
                invitation.invitedByUserId,
            )
        if (
            !invitation.invitedByUserId ||
            !inviterPermissions ||
            !hasSuperUserPermission(inviterPermissions)
        ) {
            await transaction
                .update(staffInvitations)
                .set({ isActive: false })
                .where(eq(staffInvitations.id, invitation.id))
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'auth.staff_invitation_deactivated',
                message:
                    'Eine Teameinladung wurde deaktiviert, weil der Aussteller keine wirksame Einladungsberechtigung mehr hat.',
                oldValues: { invitationId: invitation.id, isActive: true },
                newValues: { invitationId: invitation.id, isActive: false },
            })
            return { user: null, audit }
        }

        const existingUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.isDeleted, false),
                    accountIdentityMatchesService(invitation),
                ),
            )
            .limit(1)
        if (existingUsers.length > 0) return null

        const selection = await resolvePermissionSelectionInTransaction(
            transaction,
            invitation.permissionKeys,
            { allowSuperUser: false },
        )
        if (
            !selection.success ||
            getDefaultRouteForPermissions(selection.permissionKeys) === '/login'
        )
            return null

        await transaction
            .delete(staffInvitations)
            .where(eq(staffInvitations.id, invitation.id))

        const userId = Bun.randomUUIDv7()
        await transaction.insert(users).values({
            id: userId,
            username: invitation.username,
            email: invitation.email,
            accountType: 'staff',
            passwordHash,
        })
        await transaction.insert(staffAccounts).values({
            userId,
            invitedByUserId: invitation.invitedByUserId,
        })
        await transaction.insert(user_profiles).values({ userId })
        await transaction.insert(staffUserPermissions).values(
            selection.permissions.map(({ id }) => ({
                userId,
                permissionId: id,
            })),
        )
        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            actorUserId: userId,
            action: 'auth.staff_invitation_accepted',
            message: 'Eine Teameinladung wurde angenommen.',
            newValues: {
                invitationId: invitation.id,
                invitedByUserId: invitation.invitedByUserId,
                permissionKeys: selection.permissionKeys,
            },
        })
        return {
            user: {
                userId,
                username: invitation.username,
                permissionKeys: selection.permissionKeys,
            },
            audit,
        }
    })
    if (!result) return { success: false as const }
    await publishCommittedAuditLogService(result.audit)
    const user = result.user
    if (!user) {
        await publishStaffInvitationsChangedService()
        return { success: false as const }
    }
    await runBestEffortSideEffectService(
        'auth.staff_invitation_publish_failed',
        () =>
            publishUserUpdatedService(
                {
                    userId: user.userId,
                    username: user.username,
                    previousUsername: user.username,
                    permissionKeys: user.permissionKeys,
                    previousPermissionKeys: [],
                    addedPermissionKeys: user.permissionKeys,
                    removedPermissionKeys: [],
                    updatedAt: new Date().toISOString(),
                },
                'staff',
            ),
    )
    return { success: true as const }
}
