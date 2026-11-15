export type PermissionAssignmentInput = {
    currentUserIsSuperUser: boolean
    previousPermissionKeys: Array<string>
    nextPermissionKeys: Array<string>
}

export type LastActiveSuperUserInput = {
    targetUserIsActive: boolean
    targetUserWillBeActive: boolean
    previousPermissionKeys: Array<string>
    nextPermissionKeys: Array<string>
    activeSuperUserCount: number
}

export type UserUpdatePermissionPolicyInput = {
    currentUserPermissionKeys: Array<string>
    previousPermissionKeys: Array<string>
    permissionKeys: Array<string>
    availablePermissionKeys: Array<string>
    targetUserIsActive: boolean
    activeSuperUserCount: number
}
