export type ReplaceDefaultPermissionsInput = {
    permissionKeys: Array<string>
}

export type CreatePermissionPresetInput = {
    name: string
    description: string
    permissionKeys: Array<string>
}

export type UpdatePermissionPresetInput = CreatePermissionPresetInput & {
    id: string
}

export type DeletePermissionPresetInput = {
    id: string
}

export type ReplaceManagedUserPermissionsInput = {
    userId: string
    permissionKeys: Array<string>
}
