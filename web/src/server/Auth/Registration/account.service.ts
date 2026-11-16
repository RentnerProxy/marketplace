import { and, eq, or, sql } from 'drizzle-orm'
import { users, user_profiles } from '@/db/Schema/users.ts'
import { permissions, userPermissions } from '@/db/Schema/permissions.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import {
    prepareAuditContextService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'

export async function createPublicAccountInTransactionService(
    transaction: DatabaseTransaction,
    input: {
        username: string
        email: string
        passwordHash: string
        provider?: SocialProviderId
        subject?: string
        termsVersion?: string
        acceptedAt?: Date
    },
) {
    await transaction.execute(sql`select pg_advisory_xact_lock(7421906)`)
    const initialized = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isDeleted, false))
        .limit(1)
    if (!initialized.at(0))
        throw new Error('Public registration requires completed bootstrap')
    const duplicate = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                eq(users.isDeleted, false),
                or(
                    sql`lower(${users.username}) = ${input.username.toLowerCase()}`,
                    sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
                ),
            ),
        )
        .limit(1)
    if (duplicate.at(0)) return null
    if (input.provider && input.subject) {
        const existingIdentity = await transaction
            .select({ id: socialAccounts.id })
            .from(socialAccounts)
            .where(
                and(
                    eq(socialAccounts.provider, input.provider),
                    eq(socialAccounts.subject, input.subject),
                ),
            )
            .limit(1)
        if (existingIdentity.at(0)) return null
    }
    const dashboard = await transaction
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, PERMISSIONS.USER_DASHBOARD))
        .limit(1)
    const permission = dashboard.at(0)
    if (!permission)
        throw new Error('Public dashboard permission is unavailable')
    const rows = await transaction
        .insert(users)
        .values({
            username: input.username,
            email: input.email,
            passwordHash: input.passwordHash,
        })
        .returning({ id: users.id })
    const user = rows.at(0)
    if (!user) throw new Error('Public account insert returned no user')
    await transaction.insert(user_profiles).values({ userId: user.id })
    await transaction
        .insert(userPermissions)
        .values({ userId: user.id, permissionId: permission.id })
    if (input.provider && input.subject)
        await transaction.insert(socialAccounts).values({
            userId: user.id,
            provider: input.provider,
            subject: input.subject,
        })
    const auditReceipt = await writeAuditLogInTransactionService(transaction, {
        ...prepareAuditContextService(null),
        action: 'auth.registration_completed',
        message: 'Public account registration completed.',
        newValues: {
            targetUserId: user.id,
            termsVersion: input.termsVersion,
            acceptedAt: input.acceptedAt?.toISOString(),
            provider: input.provider,
        },
    })
    return { userId: user.id, auditReceipt }
}
