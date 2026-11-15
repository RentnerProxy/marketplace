import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { formatDate } from '@/lib/Date/date.ts'
import {
    createTimestampRangeFilter,
    createTrimmedIncludesStringFilter,
} from '@/lib/Table/tableFilters.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'

import UserAvatar from '../../UserAvatar.tsx'
import UserTableActions from '../Components/UserTableActions.tsx'
import type { UseUsersTableColumnsParams } from '../Types/user-management-table.types.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'

const trimmedIncludesStringFilter =
    createTrimmedIncludesStringFilter<UserManagementUser>()

export default function useUsersTableColumns({
    isDeletingUser,
    isTogglingUserActive,
    isResendingPasswordReset,
    canManageSuperUsers,
    onEditUser,
    onDeleteUser,
    onToggleUserActive,
    onPasswordReset,
}: UseUsersTableColumnsParams) {
    const { language, t } = useTranslationStore()

    return useMemo<Array<ColumnDef<ClientTableFeatures, UserManagementUser>>>(
        () => [
            {
                accessorKey: 'username',
                header: t('admin.users.username', { lng: language }),
                filterFn: trimmedIncludesStringFilter,
                enableGlobalFilter: true,
                cell: ({ row }) => (
                    <div className="flex items-center gap-3">
                        <UserAvatar
                            userId={row.original.id}
                            profileImageVersion={
                                row.original.profileImageVersion
                            }
                            username={row.original.username}
                        />
                        <span className="font-medium text-white">
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
                filterFn: trimmedIncludesStringFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) => (
                    <span className="text-secondary-text">
                        {String(getValue())}
                    </span>
                ),
            },
            {
                accessorKey: 'permissions',
                header: t('common.rights'),
                enableGlobalFilter: false,
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
                filterFn: filterFn_equalsString,
                enableGlobalFilter: false,
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
                filterFn: createTimestampRangeFilter<UserManagementUser>(),
                enableGlobalFilter: false,
                cell: ({ row }) => (
                    <span className="text-secondary-text">
                        {formatDate(row.original.createdAt)}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: t('common.actions'),
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
