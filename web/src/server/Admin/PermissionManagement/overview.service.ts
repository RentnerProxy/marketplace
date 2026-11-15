import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/db'
import {
    defaultUserPermissions,
    permissionPresetPermissions,
    permissionPresets,
    permissions,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionManagementOverview } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
import { requireSuperUserReadAccessService } from './permission-management-policy.service.ts'

const configuredPermissionKeys = Object.values(PERMISSIONS)

export async function getPermissionManagementOverviewService(
    actorUserId: string,
): Promise<PermissionManagementOverview> {
    await requireSuperUserReadAccessService(actorUserId)

    const [
        permissionRows,
        defaultPermissionRows,
        presetRows,
        presetPermissionRows,
    ] = await Promise.all([
        db
            .select({
                id: permissions.id,
                key: permissions.key,
                name: permissions.name,
                description: permissions.description,
            })
            .from(permissions)
            .where(inArray(permissions.key, configuredPermissionKeys))
            .orderBy(asc(permissions.key)),
        db
            .select({ key: permissions.key })
            .from(defaultUserPermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, defaultUserPermissions.permissionId),
            )
            .where(
                and(
                    inArray(permissions.key, configuredPermissionKeys),
                    ne(permissions.key, PERMISSIONS.ADMIN_SUPER_USER),
                ),
            )
            .orderBy(asc(permissions.key)),
        db
            .select({
                id: permissionPresets.id,
                name: permissionPresets.name,
                description: permissionPresets.description,
                createdAt: permissionPresets.createdAt,
                updatedAt: permissionPresets.updatedAt,
            })
            .from(permissionPresets)
            .orderBy(asc(permissionPresets.name), asc(permissionPresets.id)),
        db
            .select({
                presetId: permissionPresetPermissions.presetId,
                key: permissions.key,
            })
            .from(permissionPresetPermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, permissionPresetPermissions.permissionId),
            )
            .where(
                and(
                    inArray(permissions.key, configuredPermissionKeys),
                    ne(permissions.key, PERMISSIONS.ADMIN_SUPER_USER),
                ),
            )
            .orderBy(
                asc(permissionPresetPermissions.presetId),
                asc(permissions.key),
            ),
    ])
    const permissionKeysByPresetId = new Map<string, Array<string>>()

    for (const permission of presetPermissionRows) {
        const permissionKeys =
            permissionKeysByPresetId.get(permission.presetId) ?? []
        permissionKeys.push(permission.key)
        permissionKeysByPresetId.set(permission.presetId, permissionKeys)
    }

    return {
        permissions: permissionRows,
        defaultPermissionKeys: defaultPermissionRows.map(
            (permission) => permission.key,
        ),
        presets: presetRows.map(function (preset) {
            return {
                id: preset.id,
                name: preset.name,
                description: preset.description,
                permissionKeys: permissionKeysByPresetId.get(preset.id) ?? [],
                createdAt: preset.createdAt.toISOString(),
                updatedAt: preset.updatedAt.toISOString(),
            }
        }),
    }
}
