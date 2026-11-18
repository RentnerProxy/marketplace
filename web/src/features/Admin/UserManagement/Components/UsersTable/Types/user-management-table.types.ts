import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
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
    accountType: AccountType
    availablePermissions: Array<UserManagementPermission>
    isDeletingUser: boolean
    isTogglingUserActive: boolean
    isResendingPasswordReset: boolean
    isConvertingAccount: boolean
    canManageSuperUsers: boolean
    canConvertAccounts: boolean
    onEditUser: (user: UserManagementUser) => void
    onDeleteUser: (user: UserManagementUser) => void
    onToggleUserActive: (user: UserManagementUser) => void
    onPasswordReset: (user: UserManagementUser) => void
    onConvertAccount: (user: UserManagementUser) => void
}

export type UserTableActionsProps = Omit<
    UsersTableProps,
    'availablePermissions'
> & {
    user: UserManagementUser
}

export type UserTableActionsLogicReturn = {
    state: {
        isProtectedSuperUser: boolean
        isToggleStatusDisabled: boolean
        isPasswordResetDisabled: boolean
        isDeleteDisabled: boolean
        showConvertAccount: boolean
        convertAccountLabel: string
        editRestriction: string | undefined
        toggleStatusRestriction: string | undefined
        passwordResetRestriction: string | undefined
        deleteRestriction: string | undefined
    }
    handler: {
        handleEditUser: () => void
        handleToggleUserActive: () => void
        handlePasswordReset: () => void
        handleDeleteUser: () => void
        handleConvertAccount: () => void
    }
}
