import {
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    Search,
    ShieldCheck,
    Users,
} from 'lucide-react'
import { TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import type { ManagedUsersListProps } from '../Types/permission-management-component-props.types.ts'

export default function ManagedUsersList({
    state,
    handler,
}: ManagedUsersListProps) {
    const { t } = useTranslationStore()

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="shrink-0 border-b border-border-dark p-5">
                    <div className="mb-4 flex items-start gap-3">
                        <HeadingIcon icon={Users} />
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                {t('admin.permissions.users.listTitle')}
                            </h2>
                            <p className="mt-1 text-sm text-secondary-text">
                                {t('admin.permissions.users.listDescription')}
                            </p>
                        </div>
                    </div>

                    <TextInput
                        value={state.searchInput}
                        maxLength={200}
                        aria-label={t(
                            'admin.permissions.users.searchPlaceholder',
                        )}
                        onChange={(event) =>
                            handler.handleSearchInputChange(event.target.value)
                        }
                        placeholder={t(
                            'admin.permissions.users.searchPlaceholder',
                        )}
                        icon={<Search className="h-5 w-5" />}
                        className="h-11 w-full rounded-md"
                    />
                </div>

                <div className="min-h-32 flex-1 overflow-y-auto p-3">
                    {state.isError ? (
                        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                            <p className="text-sm text-secondary-text">
                                {t('admin.permissions.users.loadError')}
                            </p>
                            <button
                                type="button"
                                onClick={handler.handleRetry}
                                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-dark bg-input-dark px-3 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                            >
                                <RefreshCw className="h-4 w-4" />
                                {t('admin.permissions.retry')}
                            </button>
                        </div>
                    ) : state.isLoading ? (
                        <div className="px-4 py-8 text-center text-sm text-secondary-text">
                            {t('admin.permissions.users.loading')}
                        </div>
                    ) : state.users.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-secondary-text">
                            {t('admin.permissions.users.empty')}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {state.users.map((user) => {
                                const isSelected =
                                    state.selectedUser?.id === user.id

                                return (
                                    <button
                                        key={user.id}
                                        type="button"
                                        aria-pressed={isSelected}
                                        onClick={() =>
                                            handler.handleSelectUser(user)
                                        }
                                        className={`w-full cursor-pointer rounded-md border-2 p-3 text-left transition-[background-color,border-color,transform] ${
                                            isSelected
                                                ? 'comic-selected [&_.text-white]:text-primary-foreground [&_.text-secondary-text]:text-primary-foreground/80'
                                                : 'border-border-dark bg-input-dark/30 hover:-translate-x-px hover:-translate-y-px hover:border-primary hover:bg-input-dark'
                                        }`}
                                    >
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-white">
                                                {user.username}
                                            </span>
                                            {user.isSuperUser && (
                                                <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-foreground">
                                                    <ShieldCheck className="h-3 w-3 text-primary" />
                                                    {t(
                                                        'admin.permissions.users.superUser',
                                                    )}
                                                </span>
                                            )}
                                            {!user.isActive && (
                                                <StatusIndicator tone="danger">
                                                    {t(
                                                        'admin.permissions.users.inactive',
                                                    )}
                                                </StatusIndicator>
                                            )}
                                        </span>
                                        <span className="mt-1 block truncate text-xs text-secondary-text">
                                            {user.email}
                                        </span>
                                        <span className="mt-2 block text-xs font-medium text-secondary-text">
                                            {t(
                                                'admin.permissions.users.permissionCount',
                                                {
                                                    count: user.permissions
                                                        .length,
                                                },
                                            )}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-border-dark px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-secondary-text">
                    {t('admin.permissions.users.total', {
                        count: state.total,
                    })}
                </span>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <button
                        type="button"
                        disabled={!state.canGoPrevious || state.isLoading}
                        onClick={handler.handlePreviousPage}
                        aria-label={t('admin.permissions.users.previous')}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-20 text-center text-xs font-semibold text-secondary-text">
                        {t('admin.permissions.users.pagination', {
                            current: state.pageIndex + 1,
                            total: state.pageCount,
                        })}
                    </span>
                    <button
                        type="button"
                        disabled={!state.canGoNext || state.isLoading}
                        onClick={handler.handleNextPage}
                        aria-label={t('admin.permissions.users.next')}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </section>
    )
}
