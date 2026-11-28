import LogoutButton from './LogoutButton.tsx'
import NavigationItem from './NavigationItem.tsx'
import SidebarHeader from './SidebarHeader.tsx'
import SidebarSurface from './SidebarSurface.tsx'
import UserProfileButton from './UserProfileButton.tsx'
import type {
    AuthenticatedSidebarContentProps,
    AuthenticatedSidebarProps,
    SidebarContentProps,
} from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export function SidebarContent({
    title,
    subtitle,
    logoSrc,
    hasCustomLogo = false,
    homeTo,
    navItems,
    username,
    userIconSrc,
    activeGroupKey,
    onNavigate,
}: SidebarContentProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useAuthenticatedSidebarLogic()

    return (
        <div className="relative flex min-h-0 w-full flex-1 flex-col gap-6 pt-5 pb-1 text-[#f4f5f7] lg:pt-7 lg:pr-3">
            <div className="px-5">
                <SidebarHeader
                    title={title}
                    subtitle={subtitle}
                    logoSrc={logoSrc}
                    hasCustomLogo={hasCustomLogo}
                    homeTo={homeTo}
                    onNavigate={onNavigate}
                />
            </div>

            <nav
                aria-label={t('nav.navigation')}
                className="marketplace-sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
            >
                <div className="space-y-2.5">
                    {navItems.map((item) => (
                        <NavigationItem
                            key={item.to ?? item.labelKey}
                            item={item}
                            navigationKey={item.to ?? item.labelKey}
                            activeGroupKey={activeGroupKey}
                            openGroups={state.openGroups}
                            onToggleGroup={handler.handleToggleGroup}
                            onNavigate={onNavigate}
                        />
                    ))}
                </div>
            </nav>

            <div className="shrink-0 border-t-[3px] border-dashed border-white/25 px-5 py-3">
                <UserProfileButton
                    username={username}
                    profileImageSrc={userIconSrc}
                    onNavigate={onNavigate}
                />
                <LogoutButton />
            </div>
        </div>
    )
}

/** Straight comic panel: dark surface, speed lines and a system-colour edge. */
function ExpandedSidebar(sidebar: AuthenticatedSidebarContentProps) {
    return (
        <aside
            id="marketplace-desktop-navigation"
            className="fixed inset-y-0 left-0 z-30 isolate hidden w-(--marketplace-navigation-width) overflow-hidden lg:flex"
        >
            <SidebarSurface />
            <SidebarContent {...sidebar} />
        </aside>
    )
}

export default function AuthenticatedSidebar({
    isCollapsed,
    ...sidebar
}: AuthenticatedSidebarProps) {
    if (isCollapsed) return <aside id="marketplace-desktop-navigation" hidden />

    return <ExpandedSidebar {...sidebar} />
}
