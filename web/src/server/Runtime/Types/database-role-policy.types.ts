export type DatabaseRolePolicyRow = {
    currentRoleId: string
    sessionRoleId: string
    databaseOwnerId: string
    roleId: string
    roleName: string
    canLogin: boolean
    isSuperuser: boolean
    canCreateDatabase: boolean
    canCreateRole: boolean
    canReplicate: boolean
    canBypassRls: boolean
    ownsOtherDatabase: boolean
}
