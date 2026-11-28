import { TableProvider } from '@rentnerkev/table'
import AuthenticatedMain from './Components/AuthenticatedMain.tsx'
import AuthenticatedSidebar from './Components/AuthenticatedSidebar.tsx'
import AuthenticatedTopbar from './Components/AuthenticatedTopbar.tsx'
import MaintenanceBanner from './Components/MaintenanceBanner.tsx'
import MobileNavigation from './Components/MobileNavigation.tsx'
import BackupCreationProgressBridge from '@/features/Admin/Backups/Components/BackupCreationProgressBridge.tsx'
import useAuthenticatedShellLogic from './Hooks/useAuthenticatedShellLogic.ts'
import useAuthenticatedPageHeaderLogic from './Hooks/useAuthenticatedPageHeaderLogic.ts'
import useMobileNavigationLogic from './Hooks/useMobileNavigationLogic.ts'
import useSocialLinkedRedirect from './Hooks/useSocialLinkedRedirect.ts'
import { authenticatedTableClassNames } from '@/lib/Table/authenticatedTableStyles.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads the sidebar mask and texture stylesheet.
import './authenticated-layout.css'

export default function AuthenticatedShell() {
    const { state, handler } = useAuthenticatedShellLogic()
    const { state: pageHeader } = useAuthenticatedPageHeaderLogic()
    const mobileNavigation = useMobileNavigationLogic()
    useSocialLinkedRedirect()
    const sidebar = {
        title: state.companyName,
        subtitle: state.navigationSubtitle,
        logoSrc: state.systemLogoSrc,
        hasCustomLogo: state.hasCustomSystemLogo,
        homeTo: state.homeTo,
        navItems: state.visibleNavItems,
        username: state.username,
        userIconSrc: state.profileImageSrc64,
        activeGroupKey: pageHeader.groupKey,
    }

    return (
        <div
            className={`marketplace-signed-in app-theme-${state.themeMode} min-h-dvh bg-background-dark text-foreground ${
                state.isCollapsed
                    ? 'lg:[--marketplace-navigation-width:0px]'
                    : 'lg:[--marketplace-navigation-width:19rem]'
            }`}
            style={state.shellStyle}
        >
            <AuthenticatedSidebar
                {...sidebar}
                isCollapsed={state.isCollapsed}
            />
            <MobileNavigation
                sidebar={sidebar}
                isOpen={mobileNavigation.state.isOpen}
                onClose={mobileNavigation.handler.handleClose}
            />

            <div className="flex min-h-dvh min-w-0 flex-col transition-[margin] duration-200 motion-reduce:transition-none lg:ml-(--marketplace-navigation-width)">
                <AuthenticatedTopbar
                    isCollapsed={state.isCollapsed}
                    isMobileNavigationOpen={mobileNavigation.state.isOpen}
                    themeMode={state.themeMode}
                    showMaintenanceCountdown={
                        state.showMaintenanceBanner &&
                        state.isMaintenanceBannerMinimized
                    }
                    millisecondsUntilMaintenance={
                        state.millisecondsUntilMaintenance
                    }
                    onToggleCollapse={handler.toggleCollapse}
                    onOpenMobileNavigation={mobileNavigation.handler.handleOpen}
                    onExpandMaintenanceBanner={handler.expandMaintenanceBanner}
                />

                <TableProvider classNames={authenticatedTableClassNames}>
                    <AuthenticatedMain
                        eyebrow={pageHeader.eyebrow}
                        title={pageHeader.title}
                        description={pageHeader.description}
                    >
                        {state.showMaintenanceBanner &&
                            !state.isMaintenanceBannerMinimized && (
                                <div className="mb-5 w-full max-w-230 lg:sticky lg:top-[5.625rem] lg:z-10">
                                    <MaintenanceBanner
                                        millisecondsUntilMaintenance={
                                            state.millisecondsUntilMaintenance
                                        }
                                        pendingUsername={
                                            state
                                                .pendingMaintenanceExtensionRequest
                                                ?.user.username
                                        }
                                        isOwnRequestPending={
                                            state
                                                .pendingMaintenanceExtensionRequest
                                                ?.user.id === state.userId
                                        }
                                        onMinimize={
                                            handler.minimizeMaintenanceBanner
                                        }
                                    />
                                </div>
                            )}
                    </AuthenticatedMain>
                </TableProvider>
            </div>

            {state.canManageBackups && state.userId && (
                <BackupCreationProgressBridge
                    key={state.userId}
                    userId={state.userId}
                />
            )}
        </div>
    )
}
