import NotificationMenu from '@/features/Notifications/Components/NotificationMenu.tsx'
import useAuthenticatedTopbarLogic from '../Hooks/useAuthenticatedTopbarLogic.ts'
import type { AuthenticatedTopbarProps } from '../Types/authenticated-layout-component-props.types.ts'
import MaintenanceCountdownButton from './MaintenanceCountdownButton.tsx'

export default function AuthenticatedTopbar({
    isCollapsed,
    showMaintenanceCountdown,
    millisecondsUntilMaintenance,
    onExpandMaintenanceBanner,
}: AuthenticatedTopbarProps) {
    const { state } = useAuthenticatedTopbarLogic()

    return (
        <header
            className={`fixed right-0 top-0 z-20 h-18 border-b border-border-dark bg-surface-dark transition-[left] duration-300 ${
                isCollapsed ? 'left-20' : 'left-72'
            }`}
        >
            <div className="flex h-full items-center justify-between gap-4 px-6">
                <div className="min-w-0">
                    <h1 className="truncate text-lg font-bold leading-6 text-white">
                        {state.title}
                    </h1>
                    <p className="mt-1 truncate text-sm text-secondary-text">
                        {state.description}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {showMaintenanceCountdown && (
                        <MaintenanceCountdownButton
                            millisecondsUntilMaintenance={
                                millisecondsUntilMaintenance
                            }
                            onExpand={onExpandMaintenanceBanner}
                        />
                    )}
                    <NotificationMenu />
                </div>
            </div>
        </header>
    )
}
