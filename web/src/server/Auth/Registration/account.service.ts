import { and, eq, inArray } from 'drizzle-orm'
import {
    accountIdentityMatchesService,
    hasStaffIdentityReservationInTransactionService,
    lockAccountUniquenessInTransactionService,
} from '@/server/Auth/accountUniqueness.service.ts'
import { users, user_profiles } from '@/db/Schema/users.ts'
import { publicAccounts } from '@/db/Schema/accounts.ts'
import {
    defaultUserPermissions,
    permissions,
    publicUserPermissions,
} from '@/db/Schema/permissions.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { PUBLIC_PERMISSION_KEYS } from '@/config/permissions.config.ts'
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
    await lockAccountUniquenessInTransactionService(transaction)
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
                accountIdentityMatchesService(input),
            ),
        )
        .limit(1)
    if (
        duplicate.at(0) ||
        (await hasStaffIdentityReservationInTransactionService(
            transaction,
            input,
        ))
    )
        return null
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
    const defaults = await transaction
        .select({ id: permissions.id })
        .from(defaultUserPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, defaultUserPermissions.permissionId),
        )
        .where(inArray(permissions.key, PUBLIC_PERMISSION_KEYS))
    const rows = await transaction
        .insert(users)
        .values({
            username: input.username,
            email: input.email,
            passwordHash: input.passwordHash,
            emailVerifiedAt: new Date(),
            accountType: 'public',
        })
        .returning({ id: users.id })
    const user = rows.at(0)
    if (!user) throw new Error('Public account insert returned no user')
    await transaction.insert(publicAccounts).values({ userId: user.id })
    await transaction.insert(user_profiles).values({ userId: user.id })
    if (defaults.length > 0) {
        await transaction.insert(publicUserPermissions).values(
            defaults.map(({ id }) => ({
                userId: user.id,
                permissionId: id,
            })),
        )
    }
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
