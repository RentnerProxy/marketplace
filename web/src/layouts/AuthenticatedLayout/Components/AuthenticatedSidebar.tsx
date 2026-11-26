import LogoutButton from './LogoutButton.tsx'
import NavigationItem from './NavigationItem.tsx'
import SidebarHeader from './SidebarHeader.tsx'
import UserProfileButton from './UserProfileButton.tsx'
import type { AuthenticatedSidebarProps } from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import { flattenNavigationRoutes } from '@/lib/Navigation/navigationItems.ts'

export default function AuthenticatedSidebar({
    title,
    subtitle,
    logoSrc,
    homeTo,
    navItems,
    username,
    userIconSrc,
}: AuthenticatedSidebarProps) {
    const { state } = useAuthenticatedSidebarLogic()
    const navigationItems = state.isCollapsed
        ? flattenNavigationRoutes(navItems)
        : navItems

    return (
        <aside
            className={`fixed inset-y-0 left-0 z-30 flex border-r border-border-dark bg-surface-dark transition-[width] duration-300 ${
                state.isCollapsed ? 'w-20' : 'w-72'
            }`}
        >
            <div className="flex min-h-0 w-full flex-col">
                <SidebarHeader
                    title={title}
                    subtitle={subtitle}
                    logoSrc={logoSrc}
                    homeTo={homeTo}
                    isCollapsed={state.isCollapsed}
                />

                <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
                    {navigationItems.map((item) => (
                        <NavigationItem
                            key={item.to ?? item.labelKey}
                            item={item}
                            navigationKey={item.to ?? item.labelKey}
                            isCollapsed={state.isCollapsed}
                            openGroups={state.openGroups}
                        />
                    ))}
                </nav>

                <div className="border-t border-border-dark p-3">
                    <UserProfileButton
                        isCollapsed={state.isCollapsed}
                        username={username}
                        profileImageSrc={userIconSrc}
                    />
                    <LogoutButton isCollapsed={state.isCollapsed} />
                </div>
            </div>
        </aside>
    )
}
