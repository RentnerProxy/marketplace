import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'
import { isDeepStrictEqual } from 'node:util'
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
import { db } from '@/db'
import {
    defaultUserPermissions,
    passwordResetTokens,
    permissions,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { userInvitationConfig } from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { enqueuePasswordSetupMail } from '@/server/Queues/mail.queue.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { USER_MANAGEMENT_PERMISSION_ERROR } from './permissionPolicy.service.ts'
import type { CreateUserInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'

export async function createUserService(data: CreateUserInput) {
    const username = data.username.trim()
    const email = data.email.trim().toLowerCase()

    if (!username || !email) {
        return {
            success: false as const,
            error: 'Username und E-Mail sind erforderlich.',
        }
    }

    const placeholderPassword = crypto.randomUUID()
    const passwordHash = await Bun.password.hash(placeholderPassword)
    const createdByUserId = await getCurrentSessionUserId()
    const auditContext = prepareAuditContextService(createdByUserId)
    const token = crypto.randomUUID()
    const tokenHash = await createTokenHash(token)
    const expiresAt = new Date(Date.now() + userInvitationConfig.durationMs)
    const creationResult = await db.transaction(async function (transaction) {
        if (!createdByUserId) {
            return {
                success: false as const,
                error: USER_MANAGEMENT_PERMISSION_ERROR,
            }
        }

        await lockAuditUsersInTransactionService(transaction, [createdByUserId])
        const actorRows = await transaction
            .select({
                isActive: users.isActive,
                isDeleted: users.isDeleted,
            })
            .from(users)
            .where(eq(users.id, createdByUserId))
            .limit(1)
            .for('share')
        const actor = actorRows.at(0)

        if (!actor || !actor.isActive || actor.isDeleted) {
            return {
                success: false as const,
                error: USER_MANAGEMENT_PERMISSION_ERROR,
            }
        }

        const actorPermissionKeys = await getUserPermissionKeys(
            createdByUserId,
            transaction,
        )

        if (
            !hasPermission(
                actorPermissionKeys,
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            )
        ) {
            return {
                success: false as const,
                error: USER_MANAGEMENT_PERMISSION_ERROR,
            }
        }

        const existingUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.isDeleted, false),
                    or(eq(users.username, username), eq(users.email, email)),
                ),
            )
            .limit(1)

        if (existingUsers.length > 0) {
            return {
                success: false as const,
                error: 'Ein Benutzer mit diesem Username oder dieser E-Mail existiert bereits.',
            }
        }

        const newUsers = await transaction
            .insert(users)
            .values({
                username,
                email,
                passwordHash,
                createdByUserId,
            })
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
                isActive: users.isActive,
                createdByUserId: users.createdByUserId,
                createdAt: users.createdAt,
            })
        const user = newUsers.at(0)

        if (!user) {
            throw new Error('Benutzer konnte nicht angelegt werden.')
        }

        const createdProfiles = await transaction
            .insert(user_profiles)
            .values({ userId: user.id })
            .returning()
        const createdInvitationTokens = await transaction
            .insert(passwordResetTokens)
            .values({ userId: user.id, tokenHash, expiresAt })
            .returning()
        if (
            createdProfiles.length !== 1 ||
            createdInvitationTokens.length !== 1
        ) {
            throw new Error(
                'Die Benutzeranlage wurde nicht vollständig gespeichert.',
            )
        }

        const defaultPermissionRows = await transaction
            .select({
                id: permissions.id,
                key: permissions.key,
            })
            .from(defaultUserPermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, defaultUserPermissions.permissionId),
            )
            .where(
                and(
                    ne(permissions.key, PERMISSIONS.ADMIN_SUPER_USER),
                    inArray(permissions.key, Object.values(PERMISSIONS)),
                ),
            )
            .orderBy(asc(permissions.key))

        if (defaultPermissionRows.length > 0) {
            await transaction.insert(userPermissions).values(
                defaultPermissionRows.map(function (permission) {
                    return {
                        userId: user.id,
                        permissionId: permission.id,
                    }
                }),
            )
        }

        const permissionKeys = defaultPermissionRows.map(
            (permission) => permission.key,
        )
        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.user.created',
            message: `Benutzer ${user.username} wurde angelegt.`,
            newValues: {
                id: user.id,
                username: user.username,
                email: user.email,
                permissionKeys,
            },
        })
        return {
            success: true as const,
            user,
            permissionKeys,
            permissionIds: defaultPermissionRows
                .map((permission) => permission.id)
                .toSorted(),
            createdProfiles,
            createdInvitationTokens,
            audit,
        }
    })

    if (!creationResult.success) {
        return creationResult
    }

    const user = creationResult.user

    const origin = process.env.ORIGIN ?? 'http://localhost:3000'
    const resetLink = createPasswordResetLinkService(origin, token)

    try {
        await enqueuePasswordSetupMail({
            to: user.email,
            username: user.username,
            resetLink,
        })
    } catch {
        const cancellationAudit = await db.transaction(
            async function (transaction) {
                await lockAuditUsersInTransactionService(transaction, [
                    createdByUserId,
                    user.id,
                ])

                const currentProfiles = await transaction
                    .select()
                    .from(user_profiles)
                    .where(eq(user_profiles.userId, user.id))
                const currentPermissionRows = await transaction
                    .select({ permissionId: userPermissions.permissionId })
                    .from(userPermissions)
                    .where(eq(userPermissions.userId, user.id))
                const currentInvitationTokens = await transaction
                    .select()
                    .from(passwordResetTokens)
                    .where(eq(passwordResetTokens.userId, user.id))
                if (
                    !isDeepStrictEqual(
                        currentProfiles,
                        creationResult.createdProfiles,
                    ) ||
                    !isDeepStrictEqual(
                        currentPermissionRows
                            .map((permission) => permission.permissionId)
                            .toSorted(),
                        creationResult.permissionIds,
                    ) ||
                    !isDeepStrictEqual(
                        currentInvitationTokens,
                        creationResult.createdInvitationTokens,
                    )
                )
                    return null

                const deletedUsers = await transaction
                    .delete(users)
                    .where(
                        and(
                            eq(users.id, user.id),
                            eq(users.passwordHash, passwordHash),
                            eq(users.username, username),
                            eq(users.email, email),
                            eq(users.isActive, user.isActive),
                            eq(users.isDeleted, false),
                            eq(users.isTwoFactorEnabled, false),
                        ),
                    )
                    .returning({ id: users.id })
                if (deletedUsers.length === 0) return null
                return writeAuditLogInTransactionService(transaction, {
                    ...auditContext,
                    action: 'admin.user.creation_rolled_back',
                    message:
                        'Benutzeranlage wurde nach einem Fehler beim Einplanen der Einladung zurückgenommen.',
                    oldValues: {
                        targetUserId: user.id,
                        creationAuditLogId: creationResult.audit.id,
                    },
                })
            },
        )
        await publishCommittedAuditLogService(creationResult.audit)
        if (cancellationAudit)
            await publishCommittedAuditLogService(cancellationAudit)

        return {
            success: false as const,
            error: 'Einladungs-E-Mail konnte nicht eingeplant werden.',
        }
    }

    await publishCommittedAuditLogService(creationResult.audit)

    return {
        success: true as const,
        user: {
            ...user,
            firstName: null,
            lastName: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
            isDefaultUser: user.createdByUserId === null,
            isSuperUser: false,
            isCurrentUser: user.id === createdByUserId,
            permissions: creationResult.permissionKeys,
            profileImageVersion: null,
            createdAt: user.createdAt.toISOString(),
        },
    }
}
