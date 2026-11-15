import { useMemo, useState } from 'react'
import type { FilterFn } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { UsersTableProps } from '../Types/user-management-table.types.ts'
import type { UsersTableViewLogicReturn } from '../Types/user-management-table.types.ts'
import useUsersTableColumns from './useUsersTableColumns.tsx'
import useUsersTableQuery from './useUsersTableQuery.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

const getUserRowId = (user: UserManagementUser) => user.id
const initialSorting = [{ id: 'createdAt', desc: true }]

const userGlobalFilter: FilterFn<ClientTableFeatures, UserManagementUser> =
    function (row, _columnId, filterValue) {
        const search = String(filterValue).trim().toLocaleLowerCase()

        if (!search) {
            return true
        }

        return [
            row.original.username,
            row.original.email,
            row.original.firstName,
            row.original.lastName,
        ].some((value) => value?.toLocaleLowerCase().includes(search))
    }

function insertSortedPermission(
    sortedPermissions: Array<string>,
    permission: string,
) {
    const insertionIndex = sortedPermissions.findIndex(
        (sortedPermission) => permission < sortedPermission,
    )

    if (insertionIndex === -1) {
        return [...sortedPermissions, permission]
    }

    return [
        ...sortedPermissions.slice(0, insertionIndex),
        permission,
        ...sortedPermissions.slice(insertionIndex),
    ]
}

export default function useUsersTableViewLogic({
    availablePermissions,
    isDeletingUser,
    isTogglingUserActive,
    isResendingPasswordReset,
    canManageSuperUsers,
    onEditUser,
    onDeleteUser,
    onToggleUserActive,
    onPasswordReset,
}: UsersTableProps): UsersTableViewLogicReturn {
    const { language, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useUsersTableColumns({
        isDeletingUser,
        isTogglingUserActive,
        isResendingPasswordReset,
        canManageSuperUsers,
        onEditUser,
        onDeleteUser,
        onToggleUserActive,
        onPasswordReset,
    })

    const usersQuery = useUsersTableQuery()
    const clientTable = useClientTable({
        data: usersQuery.state.users,
        columns,
        getRowId: getUserRowId,
        initialSorting,
        globalFilterFn: userGlobalFilter,
    })

    const permissionFilterOptions = useMemo(
        () =>
            Array.from(
                new Set(
                    availablePermissions.map(function (permission) {
                        return permission.key
                    }),
                ),
            )
                .reduce<Array<string>>(insertSortedPermission, [])
                .map((permission) => ({
                    value: permission,
                    label: permission,
                })),
        [availablePermissions],
    )

    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            username: {
                type: 'text',
                maxLength: 50,
                placeholder: t('admin.users.usernameFilterPlaceholder', {
                    lng: language,
                }),
            },
            email: {
                type: 'text',
                maxLength: 255,
                placeholder: t('admin.users.emailFilterPlaceholder'),
            },
            permissions: {
                type: 'select',
                placeholder: t('admin.users.permissionFilterPlaceholder'),
                options: permissionFilterOptions,
            },
            status: {
                type: 'select',
                placeholder: t('common.status'),
                options: [
                    { value: 'active', label: t('common.active') },
                    {
                        value: 'deactivated',
                        label: t('admin.users.deactivated'),
                    },
                ],
            },
            createdAt: {
                type: 'dateRange',
                placeholder: t('admin.users.createdFilterPlaceholder'),
            },
        }),
        [language, permissionFilterOptions, t],
    )

    const userRowsOptions = [
        { value: 5, label: t('admin.users.userCount', { count: 5 }) },
        { value: 10, label: t('admin.users.userCount', { count: 10 }) },
        { value: 20, label: t('admin.users.userCount', { count: 20 }) },
        { value: 50, label: t('admin.users.userCount', { count: 50 }) },
    ]

    function handleToggleColumnFilters() {
        setShowColumnFilters((current) => !current)
    }

    return {
        table: clientTable.table,
        state: {
            columns,
            searchInput: clientTable.state.searchInput,
            showColumnFilters,
            columnFilterConfigs,
            isLoadingUsers: usersQuery.state.isLoadingUsers,
            userRowsOptions,
        },
        handler: {
            handleSearchInputChange:
                clientTable.handler.handleSearchInputChange,
            handleToggleColumnFilters,
        },
    }
}
