import {
    haveSamePermissionKeys,
    normalizePermissionKeys,
} from '@/lib/Permissions/permissionCollections.ts'
import type {
    PermissionAssignmentInput,
    LastActiveSuperUserInput,
    UserUpdatePermissionPolicyInput,
} from './Types/user-permission-policy.types.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'

export const PERMISSION_ASSIGNMENT_FORBIDDEN_ERROR =
    'Nur Superuser dürfen Berechtigungen ändern.'
export const UNKNOWN_PERMISSION_ERROR =
    'Mindestens eine angegebene Berechtigung ist unbekannt.'
export const LAST_ACTIVE_SUPER_USER_ERROR =
    'Der letzte aktive Superuser darf nicht entmachtet, deaktiviert oder gelöscht werden.'
export const USER_MANAGEMENT_PERMISSION_ERROR =
    'Dir fehlt die erforderliche Berechtigung.'

export function getUnknownPermissionKeys(
    permissionKeys: Array<string>,
    availablePermissionKeys: Array<string>,
) {
    const availablePermissionKeySet = new Set(availablePermissionKeys)

    return normalizePermissionKeys(permissionKeys).filter(
        (permissionKey) => !availablePermissionKeySet.has(permissionKey),
    )
}

export function getPermissionAssignmentError(input: PermissionAssignmentInput) {
    if (
        !input.currentUserIsSuperUser &&
        !haveSamePermissionKeys(
            input.previousPermissionKeys,
            input.nextPermissionKeys,
        )
    ) {
        return PERMISSION_ASSIGNMENT_FORBIDDEN_ERROR
    }

    return null
}

export function removesLastActiveSuperUser(input: LastActiveSuperUserInput) {
    return (
        input.targetUserIsActive &&
        hasSuperUserPermission(input.previousPermissionKeys) &&
        !(
            input.targetUserWillBeActive &&
            hasSuperUserPermission(input.nextPermissionKeys)
        ) &&
        input.activeSuperUserCount <= 1
    )
}

export function evaluateUserUpdatePermissionPolicy(
    input: UserUpdatePermissionPolicyInput,
) {
    const unknownPermissionKeys = getUnknownPermissionKeys(
        input.permissionKeys,
        input.availablePermissionKeys,
    )

    if (unknownPermissionKeys.length > 0) {
        return {
            success: false as const,
            error: UNKNOWN_PERMISSION_ERROR,
        }
    }

    const currentUserIsSuperUser = hasSuperUserPermission(
        input.currentUserPermissionKeys,
    )

    if (
        hasSuperUserPermission(input.previousPermissionKeys) &&
        !currentUserIsSuperUser
    ) {
        return {
            success: false as const,
            error: 'Nur Superuser dürfen andere Superuser bearbeiten.',
        }
    }

    if (
        hasSuperUserPermission(input.permissionKeys) &&
        !currentUserIsSuperUser
    ) {
        return {
            success: false as const,
            error: 'Nur Superuser dürfen das Superuser-Recht vergeben.',
        }
    }

    const permissionAssignmentError = getPermissionAssignmentError({
        currentUserIsSuperUser,
        previousPermissionKeys: input.previousPermissionKeys,
        nextPermissionKeys: input.permissionKeys,
    })

    if (permissionAssignmentError) {
        return {
            success: false as const,
            error: permissionAssignmentError,
        }
    }

    if (
        removesLastActiveSuperUser({
            targetUserIsActive: input.targetUserIsActive,
            targetUserWillBeActive: input.targetUserIsActive,
            previousPermissionKeys: input.previousPermissionKeys,
            nextPermissionKeys: input.permissionKeys,
            activeSuperUserCount: input.activeSuperUserCount,
        })
    ) {
        return {
            success: false as const,
            error: LAST_ACTIVE_SUPER_USER_ERROR,
        }
    }

    return {
        success: true as const,
        permissionKeysChanged: !haveSamePermissionKeys(
            input.previousPermissionKeys,
            input.permissionKeys,
        ),
    }
}
