import type { ReactNode } from 'react'
import type {
    ClientTable,
    ClientTableFeatures,
} from '@/shared/Table/Types/client-table.types.ts'

import type { ColumnDef } from '@tanstack/react-table'
import type {
    TableColumnFilterConfigs,
    TableFilterOption,
} from '@/shared/Table/Types/table.types.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'
import type { UserManagementPermission } from '../../../Types/user-management-domain.types.ts'

export type UsersTableQueryReturn = {
    state: {
        users: Array<UserManagementUser>
        isLoadingUsers: boolean
    }
}

export type UseUsersTableColumnsParams = Omit<
    UsersTableProps,
    'availablePermissions'
>

export type UsersTableViewLogicReturn = {
    table: ClientTable<UserManagementUser>
    state: {
        columns: Array<ColumnDef<ClientTableFeatures, UserManagementUser>>
        searchInput: string
        showColumnFilters: boolean
        columnFilterConfigs: TableColumnFilterConfigs
        isLoadingUsers: boolean
        userRowsOptions: Array<TableFilterOption<number>>
    }
    handler: {
        handleSearchInputChange: (filter: string) => void
        handleToggleColumnFilters: () => void
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

export type UserTableActionsProps = UseUsersTableColumnsParams & {
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
