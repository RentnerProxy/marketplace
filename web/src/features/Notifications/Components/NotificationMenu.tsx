import { Bell, Check, CheckCheck, Inbox, LoaderCircle } from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useNotificationsLogic from '../Hooks/useNotificationsLogic.ts'

export default function NotificationMenu() {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { notificationsRef },
    } = useNotificationsLogic()

    return (
        <div ref={notificationsRef} className="relative shrink-0">
            <CustomTooltip content={t('notifications.title')}>
                <button
                    type="button"
                    aria-label={t('notifications.open')}
                    aria-expanded={state.isOpen}
                    aria-haspopup="dialog"
                    onClick={handler.handleToggle}
                    className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:border-primary/40 hover:text-white"
                >
                    <Bell className="h-5 w-5" />

                    {state.unreadCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-surface-dark bg-primary px-1 text-[10px] font-bold text-white">
                            {state.unreadCount > 99 ? '99+' : state.unreadCount}
                        </span>
                    )}
                </button>
            </CustomTooltip>

            {state.isOpen && (
                <div
                    role="dialog"
                    aria-label={t('notifications.title')}
                    className="absolute right-0 top-12 w-[min(24rem,calc(100vw-3rem))] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-2xl shadow-black/30"
                >
                    <div className="border-b border-border-dark px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">
                                {t('notifications.title')}
                            </p>

                            <button
                                type="button"
                                disabled={
                                    state.unreadCount === 0 ||
                                    state.isMarkingAllAsRead
                                }
                                onClick={handler.handleMarkAllAsRead}
                                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-dark bg-input-dark px-2 text-xs font-semibold text-white transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {state.isMarkingAllAsRead ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <CheckCheck className="h-3.5 w-3.5" />
                                )}
                                {t('notifications.markAllRead')}
                            </button>
                        </div>

                        <div className="mt-3 grid grid-cols-2 rounded-md border border-border-dark bg-background-dark p-1">
                            {(['unread', 'read'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => handler.handleTabChange(tab)}
                                    className={`h-8 cursor-pointer rounded text-xs font-semibold transition-colors ${
                                        state.activeTab === tab
                                            ? 'bg-primary text-white'
                                            : 'text-secondary-text hover:text-white'
                                    }`}
                                >
                                    {t(`notifications.tabs.${tab}`)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {state.isLoading ? (
                        <div className="flex items-center justify-center px-4 py-10 text-secondary-text">
                            <LoaderCircle className="h-5 w-5 animate-spin" />
                        </div>
                    ) : state.filteredNotifications.length > 0 ? (
                        <div className="max-h-96 space-y-2 overflow-y-auto p-2">
                            {state.filteredNotifications.map((notification) => (
                                <article
                                    key={notification.id}
                                    className="rounded-md border border-border-dark px-3 py-2.5 transition-colors hover:bg-input-dark/40"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                {!notification.isRead && (
                                                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                                                )}
                                                <p className="truncate text-sm font-semibold text-white">
                                                    {notification.title}
                                                </p>
                                            </div>
                                            <p className="mt-1 text-xs leading-5 text-secondary-text">
                                                {notification.message}
                                            </p>
                                            <time
                                                dateTime={
                                                    notification.createdAt
                                                }
                                                className="mt-1.5 block text-[11px] text-secondary-text/80"
                                            >
                                                {state.dateFormatter.format(
                                                    new Date(
                                                        notification.createdAt,
                                                    ),
                                                )}
                                            </time>
                                        </div>

                                        {!notification.isRead && (
                                            <CustomTooltip
                                                content={t(
                                                    'notifications.markRead',
                                                )}
                                                disabledTrigger={
                                                    state.markingNotificationId ===
                                                    notification.id
                                                }
                                            >
                                                <button
                                                    type="button"
                                                    aria-label={t(
                                                        'notifications.markRead',
                                                    )}
                                                    disabled={
                                                        state.markingNotificationId ===
                                                        notification.id
                                                    }
                                                    onClick={() =>
                                                        handler.handleMarkAsRead(
                                                            notification.id,
                                                        )
                                                    }
                                                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {state.markingNotificationId ===
                                                    notification.id ? (
                                                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Check className="h-3.5 w-3.5" />
                                                    )}
                                                </button>
                                            </CustomTooltip>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center px-4 py-10 text-center">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border-dark bg-input-dark text-secondary-text">
                                <Inbox className="h-5 w-5" />
                            </div>
                            <p className="mt-3 text-sm font-semibold text-white">
                                {t(
                                    `notifications.empty.${state.activeTab}.title`,
                                )}
                            </p>
                            <p className="mt-1 text-sm text-secondary-text">
                                {t(
                                    `notifications.empty.${state.activeTab}.description`,
                                )}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
