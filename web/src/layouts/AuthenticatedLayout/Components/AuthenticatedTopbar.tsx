import { CustomTooltip } from '@rentnerkev/tooltips'
import { EllipsisVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import NotificationMenu from '@/features/Notifications/Components/NotificationMenu.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { AuthenticatedTopbarProps } from '../Types/authenticated-layout-component-props.types.ts'
import MaintenanceCountdownButton from './MaintenanceCountdownButton.tsx'
import ThemeModeSwitch from './ThemeModeSwitch.tsx'

export default function AuthenticatedTopbar({
    isCollapsed,
    isMobileNavigationOpen,
    themeMode,
    showMaintenanceCountdown,
    millisecondsUntilMaintenance,
    onToggleCollapse,
    onOpenMobileNavigation,
    onExpandMaintenanceBanner,
}: AuthenticatedTopbarProps) {
    const { t } = useTranslationStore()
    const collapseLabel = isCollapsed ? t('nav.expand') : t('nav.collapse')
    const CollapseIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose

    return (
        <header
            className={`sticky top-0 z-20 flex min-h-[4.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-dark bg-(--marketplace-topbar) px-4 py-3 backdrop-blur-[16px] sm:px-6 2xl:px-8 ${
                isCollapsed ? '' : 'lg:-ml-12 lg:pl-18 2xl:pl-20'
            }`}
        >
            <button
                type="button"
                aria-controls="marketplace-mobile-navigation"
                aria-expanded={isMobileNavigationOpen}
                aria-haspopup="dialog"
                aria-label={t('nav.expand')}
                onClick={onOpenMobileNavigation}
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary-text transition-colors hover:border-primary hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none lg:hidden"
            >
                <EllipsisVertical aria-hidden="true" className="size-5" />
            </button>
            <CustomTooltip side="bottom" content={collapseLabel}>
                <button
                    type="button"
                    aria-controls="marketplace-desktop-navigation"
                    aria-expanded={!isCollapsed}
                    aria-label={collapseLabel}
                    onClick={onToggleCollapse}
                    className="hidden size-12 shrink-0 cursor-pointer place-items-center rounded-xl border border-(--marketplace-border-strong) bg-(--marketplace-surface-raised) text-secondary-text transition-colors hover:border-primary/45 hover:bg-(--marketplace-surface-hover) hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none lg:grid"
                >
                    <CollapseIcon aria-hidden="true" className="size-4" />
                </button>
            </CustomTooltip>

            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                {showMaintenanceCountdown && (
                    <MaintenanceCountdownButton
                        millisecondsUntilMaintenance={
                            millisecondsUntilMaintenance
                        }
                        onExpand={onExpandMaintenanceBanner}
                    />
                )}
                <ThemeModeSwitch themeMode={themeMode} />
                <NotificationMenu />
            </div>
        </header>
    )
}
