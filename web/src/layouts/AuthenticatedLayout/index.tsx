import AuthenticatedMain from './Components/AuthenticatedMain.tsx'
import AuthenticatedSidebar from './Components/AuthenticatedSidebar.tsx'
import AuthenticatedTopbar from './Components/AuthenticatedTopbar.tsx'
import MaintenanceBanner from './Components/MaintenanceBanner.tsx'
import UserSettingsModal from '@/features/UserSettings/index.tsx'
import BackupCreationProgressBridge from '@/features/Admin/Backups/Components/BackupCreationProgressBridge.tsx'
import useAuthenticatedShellLogic from './Hooks/useAuthenticatedShellLogic.ts'

export default function AuthenticatedShell() {
    const { state, handler } = useAuthenticatedShellLogic()

    return (
        <div
            className={`app-theme-${state.themeMode} min-h-dvh bg-background-dark text-foreground`}
            style={state.shellStyle}
        >
            <AuthenticatedSidebar
                title={state.companyName}
                subtitle={state.navigationSubtitle}
                logoSrc={state.systemLogoSrc64}
                homeTo={state.homeTo}
                navItems={state.visibleNavItems}
                username={state.username}
                userIconSrc={state.profileImageSrc64}
            />

            <AuthenticatedTopbar
                isCollapsed={state.isCollapsed}
                showMaintenanceCountdown={
                    state.showMaintenanceBanner &&
                    state.isMaintenanceBannerMinimized
                }
                millisecondsUntilMaintenance={
                    state.millisecondsUntilMaintenance
                }
                onExpandMaintenanceBanner={handler.expandMaintenanceBanner}
            />

            {state.showMaintenanceBanner &&
                !state.isMaintenanceBannerMinimized && (
                    <div
                        className="fixed right-6 top-5 z-40 flex w-230 justify-center items-center mx-auto transition-[left] duration-300"
                        style={{
                            left: state.isCollapsed
                                ? 'calc(5rem + 1.5rem)'
                                : 'calc(18rem + 1.5rem)',
                        }}
                    >
                        <MaintenanceBanner
                            millisecondsUntilMaintenance={
                                state.millisecondsUntilMaintenance
                            }
                            pendingUsername={
                                state.pendingMaintenanceExtensionRequest?.user
                                    .username
                            }
                            isOwnRequestPending={
                                state.pendingMaintenanceExtensionRequest?.user
                                    .id === state.userId
                            }
                            onMinimize={handler.minimizeMaintenanceBanner}
                        />
                    </div>
                )}

            <AuthenticatedMain
                isCollapsed={state.isCollapsed}
                showMaintenanceBanner={
                    state.showMaintenanceBanner &&
                    !state.isMaintenanceBannerMinimized
                }
            />

            {state.canManageBackups && state.userId && (
                <BackupCreationProgressBridge
                    key={state.userId}
                    userId={state.userId}
                />
            )}

            <UserSettingsModal username={state.username} />
        </div>
    )
}
