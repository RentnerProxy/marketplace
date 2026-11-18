import { DataTable } from '@rentnerkev/table'
import { UsersRound } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getMarketplaceTableDateRangeOptions,
    getMarketplaceTableLocale,
} from '@/lib/Table/tableMessages.ts'
import type { UserManagementUser } from '../../Types/user-management-domain.types.ts'
import useUsersTableColumns from './Hooks/useUsersTableColumns.tsx'
import useUsersTableQuery from './Hooks/useUsersTableQuery.ts'
import type { UsersTableProps } from './Types/user-management-table.types.ts'

const pageSizeOptions = [5, 10, 20, 50] as const
const getUserSearchValues = (user: UserManagementUser) => [
    user.username,
    user.email,
    user.firstName,
    user.lastName,
]

export default function UsersTable(props: UsersTableProps) {
    const { language, t } = useTranslationStore()
    const { state } = useUsersTableQuery(props.accountType)
    const columns = useUsersTableColumns(props)
    const searchLabel = t('admin.users.searchPlaceholder')

    return (
        <DataTable
            data={state.users}
            columns={columns}
            getRowId={(user) => user.id}
            title={t(
                props.accountType === 'staff'
                    ? 'admin.staff.tableTitle'
                    : 'admin.users.tableTitle',
            )}
            description={t(
                props.accountType === 'staff'
                    ? 'admin.staff.tableDescription'
                    : 'admin.users.tableDescription',
            )}
            icon={<UsersRound className="size-5" />}
            locale={getMarketplaceTableLocale(
                language,
                t,
                t('admin.users.itemLabel'),
                {
                    loading: t('admin.users.loading'),
                    search: searchLabel,
                },
            )}
            searchPlaceholder={searchLabel}
            getSearchValues={getUserSearchValues}
            isLoading={state.isLoadingUsers}
            pageSizeOptions={pageSizeOptions.map((count) => ({
                value: count,
                label: t('admin.users.userCount', { count }),
            }))}
            tableOptions={{
                initialState: { sorting: [{ id: 'createdAt', desc: true }] },
            }}
            columnWidthMode="scroll"
            dateRangeOptions={getMarketplaceTableDateRangeOptions(language)}
            resizableColumns
            columnSettings
        />
    )
}
