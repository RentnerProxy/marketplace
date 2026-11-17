import type { DataTableProps, TableColumn } from '@rentnerkev/table/types'
import { ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { formatDate } from '@/lib/Date/date.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'

import UserAvatar from '../../UserAvatar.tsx'
import UserTableActions from '../Components/UserTableActions.tsx'
import type { UsersTableProps } from '../Types/user-management-table.types.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'

export const usersTableOptions = {
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
    globalFilterFn: ({ original }, _columnId, value) => {
        const search = String(value).trim().toLocaleLowerCase()
        return [
            original.username,
            original.email,
            original.firstName,
            original.lastName,
        ].some((part) => part?.toLocaleLowerCase().includes(search))
    },
} satisfies NonNullable<DataTableProps<UserManagementUser>['tableOptions']>

export default function useUsersTableColumns({
    availablePermissions,
    isDeletingUser,
    isTogglingUserActive,
    isResendingPasswordReset,
    canManageSuperUsers,
    onEditUser,
    onDeleteUser,
    onToggleUserActive,
    onPasswordReset,
}: UsersTableProps) {
    const { language, t } = useTranslationStore()

    return useMemo<Array<TableColumn<UserManagementUser>>>(
        () => [
            {
                accessorKey: 'username',
                header: t('admin.users.username', { lng: language }),
                size: 230,
                minSize: 150,
                enableHiding: false,
                enableGlobalFilter: true,
                meta: {
                    filter: {
                        type: 'text',
                        maxLength: 50,
                        placeholder: t('admin.users.usernameFilterPlaceholder'),
                    },
                },
                cell: ({ row }) => (
                    <div className="flex flex-wrap items-center gap-3">
                        <UserAvatar
                            userId={row.original.id}
                            profileImageVersion={
                                row.original.profileImageVersion
                            }
                            username={row.original.username}
                        />
                        <span className="min-w-0 wrap-anywhere font-medium text-white">
                            {row.original.username}
                        </span>
                        {row.original.isSuperUser && (
                            <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-input-dark px-2 py-0.5 text-xs font-medium text-foreground">
                                <ShieldCheck className="h-3 w-3 text-primary" />
                                {t('admin.users.superuser')}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'email',
                header: t('admin.users.email'),
                size: 260,
                minSize: 140,
                enableGlobalFilter: false,
                meta: {
                    filter: {
                        type: 'text',
                        maxLength: 255,
                        placeholder: t('admin.users.emailFilterPlaceholder'),
                    },
                },
                cell: ({ getValue }) => (
                    <span className="wrap-anywhere text-secondary-text">
                        {String(getValue())}
                    </span>
                ),
            },
            {
                accessorKey: 'permissions',
                header: t('common.rights'),
                size: 160,
                minSize: 125,
                enableGlobalFilter: false,
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('admin.users.permissionFilterPlaceholder'),
                        options: [
                            ...new Set(availablePermissions.map(({ key }) => key)),
                        ].toSorted().map((key) => ({ value: key, label: key })),
                    },
                },
                filterFn: (row, columnId, filterValue) => {
                    const permissions = row.getValue<Array<string>>(columnId)

                    return permissions.includes(String(filterValue))
                },
                cell: ({ row }) => (
                    <span className="inline-flex items-center gap-2 rounded-sm border border-border-dark bg-input-dark px-2.5 py-1 text-xs font-medium text-foreground">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        {t('admin.users.rightsCount', {
                            count: row.original.permissions.length,
                        })}
                    </span>
                ),
            },
            {
                id: 'status',
                accessorFn: (user) =>
                    user.isActive ? 'active' : 'deactivated',
                header: t('common.status'),
                size: 135,
                minSize: 110,
                enableGlobalFilter: false,
                meta: {
                    filter: {
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
                },
                cell: ({ row }) => (
                    <StatusIndicator
                        tone={row.original.isActive ? 'success' : 'danger'}
                    >
                        {row.original.isActive
                            ? t('common.active')
                            : t('admin.users.deactivated')}
                    </StatusIndicator>
                ),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.users.created'),
                size: 180,
                minSize: 135,
                enableGlobalFilter: false,
                meta: {
                    filter: {
                        type: 'dateRange',
                        placeholder: t('admin.users.createdFilterPlaceholder'),
                    },
                },
                cell: ({ row }) => (
                    <span className="text-secondary-text">
                        {formatDate(row.original.createdAt)}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: t('common.actions'),
                size: 200,
                minSize: 200,
                enableHiding: false,
                enableResizing: false,
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) => (
                    <UserTableActions
                        user={row.original}
                        isDeletingUser={isDeletingUser}
                        isTogglingUserActive={isTogglingUserActive}
                        isResendingPasswordReset={isResendingPasswordReset}
                        canManageSuperUsers={canManageSuperUsers}
                        onEditUser={onEditUser}
                        onDeleteUser={onDeleteUser}
                        onToggleUserActive={onToggleUserActive}
                        onPasswordReset={onPasswordReset}
                    />
                ),
            },
        ],
        [
            availablePermissions,
            canManageSuperUsers,
            isDeletingUser,
            isResendingPasswordReset,
            isTogglingUserActive,
            language,
            onDeleteUser,
            onEditUser,
            onPasswordReset,
            onToggleUserActive,
            t,
        ],
    )
}
