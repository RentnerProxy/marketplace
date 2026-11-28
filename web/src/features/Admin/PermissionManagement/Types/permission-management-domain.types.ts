export type PermissionManagementTab = 'presets' | 'users'

export type PermissionManagementPermission = {
    id: string
    key: string
    name: string
    description: string
}

export type PermissionPreset = {
    id: string
    name: string
    description: string
    permissionKeys: Array<string>
    createdAt: string
    updatedAt: string
}

export type PermissionManagementOverview = {
    permissions: Array<PermissionManagementPermission>
    presets: Array<PermissionPreset>
}

export type PermissionManagementUser = {
    id: string
    username: string
    email: string
    isActive: boolean
    isSuperUser: boolean
    isCurrentUser: boolean
    permissions: Array<string>
}
