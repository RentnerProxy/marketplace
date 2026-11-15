import TableFooter from '@/shared/Table/TableFooter.tsx'
import TableSearchToolbar from '@/shared/Table/TableSearchToolbar.tsx'
import TableBody from '@/shared/Table/TableBody.tsx'
import TableHead from '@/shared/Table/TableHead.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { UsersRound } from 'lucide-react'
import useUsersTableViewLogic from './Hooks/useUsersTableViewLogic.ts'
import type { UsersTableProps } from './Types/user-management-table.types.ts'

export default function UsersTable({
    availablePermissions,
    isDeletingUser,
    isResendingPasswordReset,
    isTogglingUserActive,
    canManageSuperUsers,
    onEditUser,
    onDeleteUser,
    onToggleUserActive,
    onPasswordReset,
}: UsersTableProps) {
    const { t } = useTranslationStore()

    const { state, handler, table } = useUsersTableViewLogic({
        availablePermissions,
        isDeletingUser,
        isTogglingUserActive,
        isResendingPasswordReset,
        canManageSuperUsers,
        onEditUser,
        onDeleteUser,
        onToggleUserActive,
        onPasswordReset,
    })

    return (
        <section className="rounded-xl border border-border-dark bg-surface-dark">
            <div className="flex flex-col gap-4 border-b border-border-dark px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={UsersRound} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.users.tableTitle')}
                        </h2>
                        <p className="text-sm text-secondary-text">
                            {t('admin.users.tableDescription')}
                        </p>
                    </div>
                </div>

                <TableSearchToolbar
                    table={table}
                    value={state.searchInput}
                    placeholder={t('admin.users.searchPlaceholder')}
                    showColumnFilters={state.showColumnFilters}
                    onChange={handler.handleSearchInputChange}
                    onToggleFilters={handler.handleToggleColumnFilters}
                    maxLength={200}
                />
            </div>

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                    <TableHead
                        table={table}
                        showColumnFilters={state.showColumnFilters}
                        columnFilterConfigs={state.columnFilterConfigs}
                    />

                    <TableBody
                        table={table}
                        columnCount={state.columns.length}
                        isLoading={state.isLoadingUsers}
                        searchInput={state.searchInput}
                        loadingState={{ description: t('admin.users.loading') }}
                    />

                    <TableFooter
                        table={table}
                        columnCount={state.columns.length}
                        itemLabel={t('admin.users.itemLabel')}
                        pageSizeOptions={state.userRowsOptions}
                    />
                </table>
            </div>
        </section>
    )
}
