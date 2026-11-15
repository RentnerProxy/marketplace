import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import {
    systemSettings,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { DEFAULT_ADMIN_PERMISSION_KEYS } from '@/config/permissions.config.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { logError } from '@/server/Logging/logger.ts'
import type { CreateFirstSuperUserAccountInput } from '@/features/Auth/FirstSuperUser/Types/first-super-user-server-input.types.ts'
import { syncDefaultPermissions } from './permissions.service.ts'
import {
    clearFirstSuperUserSetupAccessService,
    hasValidFirstSuperUserSetupAccessService,
} from './first-super-user-setup-access.service.ts'

const FIRST_SUPER_USER_LOCK_ID = 7_421_906

async function hasUsers(transaction: DatabaseTransaction | typeof db) {
    const existingUsers = await transaction
        .select({ id: users.id })
        .from(users)
        .limit(1)

    return existingUsers.length > 0
}

async function lockFirstSuperUserSetup(transaction: DatabaseTransaction) {
    await transaction.execute(
        sql`select pg_advisory_xact_lock(${FIRST_SUPER_USER_LOCK_ID})`,
    )
}

async function ensureSystemSettings(transaction: DatabaseTransaction) {
    await transaction
        .insert(systemSettings)
        .values({
            id: 'default',
            companyName: PROJECT_CONFIG.defaultName,
        })
        .onConflictDoNothing()
}

async function ensureInitialSystemData(transaction: DatabaseTransaction) {
    const { permissions: availablePermissions } =
        await syncDefaultPermissions(transaction)
    await ensureSystemSettings(transaction)

    return availablePermissions
}

export async function getFirstSuperUserSetupStatusService() {
    return { isRequired: !(await hasUsers(db)) }
}

export async function createFirstSuperUserAccountService(
    data: CreateFirstSuperUserAccountInput,
) {
    if (!(await hasValidFirstSuperUserSetupAccessService(data.setupToken))) {
        return {
            success: false as const,
            errorCode: 'invalid_setup_token' as const,
        }
    }

    const auditContext = prepareAuditContextService(null)
    const result = await db.transaction(async function (transaction) {
        await lockFirstSuperUserSetup(transaction)

        if (await hasUsers(transaction)) {
            return {
                success: false as const,
                errorCode: 'setup_already_completed' as const,
            }
        }

        const availablePermissions = await ensureInitialSystemData(transaction)
        const insertedUsers = await transaction
            .insert(users)
            .values({
                username: data.username.trim(),
                email: data.email.trim().toLowerCase(),
                passwordHash: await Bun.password.hash(data.password),
                isActive: true,
            })
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
            })
        const user = insertedUsers.at(0)

        if (!user) {
            throw new Error('Der erste Superuser konnte nicht angelegt werden.')
        }

        await transaction.insert(user_profiles).values({
            userId: user.id,
            firstName: data.firstName || null,
            lastName: data.lastName || null,
            street: data.street || null,
            houseNumber: data.houseNumber || null,
            postalCode: data.postalCode || null,
            city: data.city || null,
        })

        const adminPermissions = availablePermissions.filter((permission) =>
            DEFAULT_ADMIN_PERMISSION_KEYS.includes(permission.key),
        )

        if (adminPermissions.length > 0) {
            await transaction
                .insert(userPermissions)
                .values(
                    adminPermissions.map((permission) => ({
                        userId: user.id,
                        permissionId: permission.id,
                    })),
                )
                .onConflictDoNothing()
        }

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'system.first-super-user.created',
                actorUserId: user.id,
                message: `Erster Superuser ${user.username} wurde angelegt.`,
                newValues: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                },
            },
        )
        return { success: true as const, user, auditReceipt }
    })

    if (result.success) {
        await publishCommittedAuditLogService(result.auditReceipt)
        try {
            await clearFirstSuperUserSetupAccessService()
        } catch (error) {
            logError(
                'system.first-super-user.setup_access_cleanup_failed',
                error,
            )
        }

        return { success: true as const, user: result.user }
    }

    return result
}
