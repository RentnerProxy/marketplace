import { PERMISSIONS } from '@/config/permissions.config.ts'

export function haveSamePermissionKeys(
    firstPermissionKeys: Array<string>,
    secondPermissionKeys: Array<string>,
) {
    const firstPermissionKeySet = new Set(firstPermissionKeys)
    const secondPermissionKeySet = new Set(secondPermissionKeys)

    return (
        firstPermissionKeySet.size === secondPermissionKeySet.size &&
        [...firstPermissionKeySet].every((permissionKey) =>
            secondPermissionKeySet.has(permissionKey),
        )
    )
}

export function withoutSuperUserPermission(permissionKeys: Array<string>) {
    return permissionKeys.filter(
        (permissionKey) => permissionKey !== PERMISSIONS.ADMIN_SUPER_USER,
    )
}

export function normalizePermissionKeys(permissionKeys: Array<string>) {
    return [...new Set(permissionKeys)]
}

export function togglePermissionKey(
    permissionKeys: Array<string>,
    permissionKey: string,
) {
    return permissionKeys.includes(permissionKey)
        ? permissionKeys.filter((key) => key !== permissionKey)
        : [...permissionKeys, permissionKey]
}
