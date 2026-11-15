import {
    normalizePermissionKeys,
    withoutSuperUserPermission,
} from '@/lib/Permissions/permissionCollections.ts'
import type { PermissionPreset } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

export function getAppliedPermissionPresets(
    presets: Array<PermissionPreset>,
    permissionKeys: Array<string>,
) {
    const selectedPermissionKeys = new Set(permissionKeys)

    return presets.filter(function (preset) {
        const presetPermissionKeys = withoutSuperUserPermission(
            preset.permissionKeys,
        )

        return (
            presetPermissionKeys.length > 0 &&
            presetPermissionKeys.every((permissionKey) =>
                selectedPermissionKeys.has(permissionKey),
            )
        )
    })
}

export function getPresetPermissionKeys(presets: Array<PermissionPreset>) {
    return normalizePermissionKeys(
        presets.flatMap((preset) =>
            withoutSuperUserPermission(preset.permissionKeys),
        ),
    )
}
