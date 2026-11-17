import { DataTable } from '@rentnerkev/table'
import { UsersRound } from 'lucide-react'
import { TABLE_LOCALES } from '@/config/language-library.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getMarketplaceTableMessages } from '@/lib/Table/tableMessages.ts'
import useUsersTableColumns, {
    usersTableOptions,
} from './Hooks/useUsersTableColumns.tsx'
import useUsersTableQuery from './Hooks/useUsersTableQuery.ts'
import type { UsersTableProps } from './Types/user-management-table.types.ts'

const pageSizeOptions = [5, 10, 20, 50] as const

export default function UsersTable(props: UsersTableProps) {
    const { language, t } = useTranslationStore()
    const { state } = useUsersTableQuery()
    const columns = useUsersTableColumns(props)
    const searchLabel = t('admin.users.searchPlaceholder')

    return (
        <DataTable
            data={state.users}
            columns={columns}
            getRowId={(user) => user.id}
            title={t('admin.users.tableTitle')}
            description={t('admin.users.tableDescription')}
            icon={<UsersRound className="size-5" />}
            locale={TABLE_LOCALES[language]}
            messages={{
                ...getMarketplaceTableMessages(t, t('admin.users.itemLabel')),
                loading: t('admin.users.loading'),
                search: searchLabel,
            }}
            searchPlaceholder={searchLabel}
            isLoading={state.isLoadingUsers}
            pageSizeOptions={pageSizeOptions}
            tableOptions={usersTableOptions}
            classNames={{ table: 'min-w-[860px]' }}
            resizableColumns
            columnSettings
        />
    )
}
