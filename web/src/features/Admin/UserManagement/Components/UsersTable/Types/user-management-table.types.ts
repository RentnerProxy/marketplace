import type { ReactNode } from 'react'
import type {
    UserManagementPermission,
    UserManagementUser,
} from '../../../Types/user-management-domain.types.ts'

export type UsersTableQueryReturn = {
    state: {
        users: Array<UserManagementUser>
        isLoadingUsers: boolean
    }
}

export type UsersTableProps = {
    availablePermissions: Array<UserManagementPermission>
    isDeletingUser: boolean
    isTogglingUserActive: boolean
    isResendingPasswordReset: boolean
    canManageSuperUsers: boolean
    onEditUser: (user: UserManagementUser) => void
    onDeleteUser: (user: UserManagementUser) => void
    onToggleUserActive: (user: UserManagementUser) => void
    onPasswordReset: (user: UserManagementUser) => void
}

export type UserTableActionsProps = Omit<
    UsersTableProps,
    'availablePermissions'
> & {
    user: UserManagementUser
}

export type UserTableActionButtonProps = {
    ariaLabel: string
    children: ReactNode
    className: string
    disabled: boolean
    onClick: () => void
    tooltip: string
}

export type UserTableActionsLogicReturn = {
    state: {
        isProtectedSuperUser: boolean
        cannotDeactivateCurrentUser: boolean
        cannotDeleteCurrentUser: boolean
        isToggleStatusDisabled: boolean
        isPasswordResetDisabled: boolean
        isDeleteDisabled: boolean
        editTooltip: string
        toggleStatusTooltip: string
        passwordResetTooltip: string
        deleteTooltip: string
    }
    handler: {
        handleEditUser: () => void
        handleToggleUserActive: () => void
        handlePasswordReset: () => void
        handleDeleteUser: () => void
    }
}
