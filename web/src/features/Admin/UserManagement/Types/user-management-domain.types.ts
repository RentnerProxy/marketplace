export type UserManagementUser = {
    id: string
    username: string
    email: string
    isActive: boolean
    isSuperUser: boolean
    isCurrentUser: boolean
    createdAt: string
    profileImageVersion: number | null
    permissions: Array<string>
}

export type UserManagementPermission = {
    id: string
    key: string
    name: string
    description: string
}
