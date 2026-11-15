import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type {
    PersistedPreset,
    PermissionPresetMutationInput,
} from './Types/permission-management.types.ts'

import { haveSamePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissionPresetPermissions,
    permissionPresets,
    permissions,
} from '@/db/schema.ts'
import type {
    CreatePermissionPresetInput,
    DeletePermissionPresetInput,
    UpdatePermissionPresetInput,
} from '@/features/Admin/PermissionManagement/Types/permission-management-server-input.types.ts'
import type { PermissionPreset } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
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

const DUPLICATE_PRESET_NAME_ERROR =
    'Ein Rechte-Preset mit diesem Namen existiert bereits.'
const PRESET_NOT_FOUND_ERROR = 'Rechte-Preset wurde nicht gefunden.'

function createPresetProjection(
    preset: PersistedPreset,
    permissionKeys: Array<string>,
): PermissionPreset {
    return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        permissionKeys,
        createdAt: preset.createdAt.toISOString(),
        updatedAt: preset.updatedAt.toISOString(),
    }
}

async function loadPresetPermissionKeysInTransaction(
    transaction: DatabaseTransaction,
    presetId: string,
) {
    const permissionRows = await transaction
        .select({ key: permissions.key })
        .from(permissionPresetPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, permissionPresetPermissions.permissionId),
        )
        .where(eq(permissionPresetPermissions.presetId, presetId))
        .orderBy(asc(permissions.key))

    return permissionRows.map((permission) => permission.key)
}

async function replacePresetPermissionsInTransaction(
    transaction: DatabaseTransaction,
    presetId: string,
    selectedPermissions: Array<{ id: string }>,
) {
    await transaction
        .delete(permissionPresetPermissions)
        .where(eq(permissionPresetPermissions.presetId, presetId))

    if (selectedPermissions.length === 0) {
        return
    }

    await transaction.insert(permissionPresetPermissions).values(
        selectedPermissions.map(function (permission) {
            return {
                presetId,
                permissionId: permission.id,
            }
        }),
    )
}

async function publishPresetMutation(input: PermissionPresetMutationInput) {
    await runBestEffortSideEffectService(
        'permission_management.preset_publish_failed',
        function () {
            return publishPermissionManagementUpdatedService({
                scope: 'presets',
                updatedAt: new Date().toISOString(),
            })
        },
        input,
    )
}

export async function createPermissionPresetService(
    input: CreatePermissionPresetInput,
    actorUserId: string,
) {
    const name = input.name.trim()
    const description = input.description.trim()
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

            const permissionSelection =
                await resolvePermissionSelectionInTransaction(
                    transaction,
                    input.permissionKeys,
                    { allowSuperUser: false },
                )

            if (!permissionSelection.success) {
                return permissionSelection
            }

            const insertedPresets = await transaction
                .insert(permissionPresets)
                .values({ name, description })
                .onConflictDoNothing({ target: permissionPresets.name })
                .returning({
                    id: permissionPresets.id,
                    name: permissionPresets.name,
                    description: permissionPresets.description,
                    createdAt: permissionPresets.createdAt,
                    updatedAt: permissionPresets.updatedAt,
                })
            const preset = insertedPresets.at(0)

            if (!preset) {
                return {
                    success: false as const,
                    error: DUPLICATE_PRESET_NAME_ERROR,
                }
            }

            await replacePresetPermissionsInTransaction(
                transaction,
                preset.id,
                permissionSelection.permissions,
            )

            const createdPreset = createPresetProjection(
                preset,
                permissionSelection.permissionKeys,
            )
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.permissions.preset.created',
                message: `Rechte-Preset ${createdPreset.name} wurde angelegt.`,
                newValues: createdPreset,
            })
            return {
                success: true as const,
                changed: true as const,
                preset: createdPreset,
                audit,
            }
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    const { audit, ...result } = transactionResult
    await publishCommittedAuditLogService(audit)
    await publishPresetMutation({
        actorUserId,
        presetId: transactionResult.preset.id,
        operation: 'created',
    })

    return result
}

export async function updatePermissionPresetService(
    input: UpdatePermissionPresetInput,
    actorUserId: string,
) {
    const name = input.name.trim()
    const description = input.description.trim()
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

            const presetRows = await transaction
                .select({
                    id: permissionPresets.id,
                    name: permissionPresets.name,
                    description: permissionPresets.description,
                    createdAt: permissionPresets.createdAt,
                    updatedAt: permissionPresets.updatedAt,
                })
                .from(permissionPresets)
                .where(eq(permissionPresets.id, input.id))
                .limit(1)
                .for('update')
            const previousPresetRow = presetRows.at(0)

            if (!previousPresetRow) {
                return {
                    success: false as const,
                    error: PRESET_NOT_FOUND_ERROR,
                }
            }

            const duplicatePresetRows = await transaction
                .select({ id: permissionPresets.id })
                .from(permissionPresets)
                .where(
                    and(
                        ne(permissionPresets.id, input.id),
                        eq(permissionPresets.name, name),
                    ),
                )
                .limit(1)

            if (duplicatePresetRows.length > 0) {
                return {
                    success: false as const,
                    error: DUPLICATE_PRESET_NAME_ERROR,
                }
            }

            const previousPermissionKeys =
                await loadPresetPermissionKeysInTransaction(
                    transaction,
                    input.id,
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

            const previousPreset = createPresetProjection(
                previousPresetRow,
                previousPermissionKeys,
            )
            const permissionKeysChanged = !haveSamePermissionKeys(
                previousPermissionKeys,
                permissionSelection.permissionKeys,
            )
            const metadataChanged =
                previousPresetRow.name !== name ||
                previousPresetRow.description !== description

            if (!permissionKeysChanged && !metadataChanged) {
                return {
                    success: true as const,
                    changed: false as const,
                    previousPreset,
                    preset: previousPreset,
                }
            }

            const updatedAt = new Date()
            const updatedPresetRows = await transaction
                .update(permissionPresets)
                .set({ name, description, updatedAt })
                .where(eq(permissionPresets.id, input.id))
                .returning({
                    id: permissionPresets.id,
                    name: permissionPresets.name,
                    description: permissionPresets.description,
                    createdAt: permissionPresets.createdAt,
                    updatedAt: permissionPresets.updatedAt,
                })
            const updatedPreset = updatedPresetRows.at(0)

            if (!updatedPreset) {
                return {
                    success: false as const,
                    error: PRESET_NOT_FOUND_ERROR,
                }
            }

            if (permissionKeysChanged) {
                await replacePresetPermissionsInTransaction(
                    transaction,
                    input.id,
                    permissionSelection.permissions,
                )
            }

            const preset = createPresetProjection(
                updatedPreset,
                permissionSelection.permissionKeys,
            )
            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.permissions.preset.updated',
                message: `Rechte-Preset ${preset.name} wurde aktualisiert.`,
                oldValues: previousPreset,
                newValues: preset,
            })
            return {
                success: true as const,
                changed: true as const,
                previousPreset,
                preset,
                audit,
            }
        },
    )

    if (!transactionResult.success || !transactionResult.changed) {
        return transactionResult
    }

    const { audit, ...result } = transactionResult
    await publishCommittedAuditLogService(audit)
    await publishPresetMutation({
        actorUserId,
        presetId: transactionResult.preset.id,
        operation: 'updated',
    })

    return result
}

export async function deletePermissionPresetService(
    input: DeletePermissionPresetInput,
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

            const presetRows = await transaction
                .select({
                    id: permissionPresets.id,
                    name: permissionPresets.name,
                    description: permissionPresets.description,
                    createdAt: permissionPresets.createdAt,
                    updatedAt: permissionPresets.updatedAt,
                })
                .from(permissionPresets)
                .where(eq(permissionPresets.id, input.id))
                .limit(1)
                .for('update')
            const presetRow = presetRows.at(0)

            if (!presetRow) {
                return {
                    success: false as const,
                    error: PRESET_NOT_FOUND_ERROR,
                }
            }

            const permissionKeys = await loadPresetPermissionKeysInTransaction(
                transaction,
                input.id,
            )
            const preset = createPresetProjection(presetRow, permissionKeys)

            await transaction
                .delete(permissionPresets)
                .where(eq(permissionPresets.id, input.id))

            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.permissions.preset.deleted',
                message: `Rechte-Preset ${preset.name} wurde gelöscht.`,
                oldValues: preset,
            })
            return {
                success: true as const,
                changed: true as const,
                preset,
                audit,
            }
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    const { audit, ...result } = transactionResult
    await publishCommittedAuditLogService(audit)
    await publishPresetMutation({
        actorUserId,
        presetId: transactionResult.preset.id,
        operation: 'deleted',
    })

    return result
}
