export type UserManagementUser = {
    id: string
    username: string
    email: string
    firstName: string | null
    lastName: string | null
    street: string | null
    houseNumber: string | null
    postalCode: string | null
    city: string | null
    isActive: boolean
    createdByUserId: string | null
    isDefaultUser: boolean
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
