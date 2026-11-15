import { haveSamePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { defaultUserPermissions, permissions } from '@/db/schema.ts'
import type { ReplaceDefaultPermissionsInput } from '@/features/Admin/PermissionManagement/Types/permission-management-server-input.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { publishPermissionManagementUpdatedService } from '@/server/Realtime/publish.service.ts'
import {
    hasSuperUserMutationAccessInTransaction,
    PERMISSION_MANAGEMENT_PERMISSION_ERROR,
    resolvePermissionSelectionInTransaction,
} from './permission-management-policy.service.ts'

import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'

export async function replaceDefaultPermissionsService(
    input: ReplaceDefaultPermissionsInput,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const transactionResult = await db.transaction(
        async function (transaction) {
            if (
                !(await hasSuperUserMutationAccessInTransaction(
                    transaction,
                    actorUserId,
                ))
            ) {
                return {
                    success: false as const,
                    error: PERMISSION_MANAGEMENT_PERMISSION_ERROR,
                }
            }

            const previousPermissionRows = await transaction
                .select({ key: permissions.key })
                .from(defaultUserPermissions)
                .innerJoin(
                    permissions,
                    eq(permissions.id, defaultUserPermissions.permissionId),
                )
                .orderBy(asc(permissions.key))
            const previousPermissionKeys = previousPermissionRows.map(
                (permission) => permission.key,
            )
            const permissionSelection =
                await resolvePermissionSelectionInTransaction(
                    transaction,
                    input.permissionKeys,
                    { allowSuperUser: false },
                )

            if (!permissionSelection.success) {
                return permissionSelection
            }

            if (
                haveSamePermissionKeys(
                    previousPermissionKeys,
                    permissionSelection.permissionKeys,
                )
            ) {
                return {
                    success: true as const,
                    changed: false as const,
                    previousPermissionKeys,
                    permissionKeys: permissionSelection.permissionKeys,
                }
            }

            await transaction.delete(defaultUserPermissions)

            if (permissionSelection.permissions.length > 0) {
                await transaction.insert(defaultUserPermissions).values(
                    permissionSelection.permissions.map(function (permission) {
                        return { permissionId: permission.id }
                    }),
                )
            }

            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.permissions.defaults.updated',
                message:
                    'Standardrechte für neue Benutzer wurden aktualisiert.',
                oldValues: { permissionKeys: previousPermissionKeys },
                newValues: {
                    permissionKeys: permissionSelection.permissionKeys,
                },
            })
            return {
                success: true as const,
                changed: true as const,
                audit,
                previousPermissionKeys,
                permissionKeys: permissionSelection.permissionKeys,
            }
        },
    )

    if (!transactionResult.success || !transactionResult.changed) {
        return transactionResult
    }

    const updatedAt = new Date().toISOString()

    const { audit, ...result } = transactionResult
    await publishCommittedAuditLogService(audit)
    await runBestEffortSideEffectService(
        'permission_management.defaults_publish_failed',
        function () {
            return publishPermissionManagementUpdatedService({
                scope: 'defaults',
                updatedAt,
            })
        },
        { actorUserId },
    )

    return result
}
