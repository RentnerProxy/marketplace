import LogoutButton from './LogoutButton.tsx'
import NavigationItem from './NavigationItem.tsx'
import SidebarHeader from './SidebarHeader.tsx'
import SidebarSurface from './SidebarSurface.tsx'
import UserProfileButton from './UserProfileButton.tsx'
import type {
    AuthenticatedSidebarProps,
    SidebarContentProps,
} from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export function SidebarContent({
    title,
    subtitle,
    logoSrc,
    homeTo,
    navItems,
    username,
    userIconSrc,
    isCollapsed,
    activeGroupKey,
    isDesktop = false,
    onNavigate,
}: SidebarContentProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useAuthenticatedSidebarLogic()

    return (
        <div
            className={`relative flex min-h-0 w-full flex-1 flex-col text-[#f4f5f7] ${
                isCollapsed ? 'gap-4 pt-5 pb-2' : 'gap-6 pt-5 pb-1 lg:pt-7'
            } ${isDesktop ? 'marketplace-sidebar-mask' : ''}`}
        >
            <div
                className={
                    isCollapsed ? 'pr-4 pl-2' : 'px-5 lg:pr-15 lg:pl-[1.35rem]'
                }
            >
                <SidebarHeader
                    title={title}
                    subtitle={subtitle}
                    logoSrc={logoSrc}
                    homeTo={homeTo}
                    isCollapsed={isCollapsed}
                    onNavigate={onNavigate}
                />
            </div>

            <nav
                aria-label={t('nav.navigation')}
                className={`min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto overscroll-contain ${
                    isDesktop && !isCollapsed
                        ? 'scrollbar-none'
                        : 'marketplace-sidebar-scroll'
                } ${isCollapsed ? 'pr-4 pl-2' : ''}`}
            >
                {navItems.map((item) => (
                    <NavigationItem
                        key={item.to ?? item.labelKey}
                        item={item}
                        navigationKey={item.to ?? item.labelKey}
                        isCollapsed={isCollapsed}
                        activeGroupKey={activeGroupKey}
                        openGroups={state.openGroups}
                        onToggleGroup={(group) =>
                            handler.handleToggleGroup(group, isCollapsed)
                        }
                        onNavigate={onNavigate}
                    />
                ))}
            </nav>

            <div
                className={`shrink-0 border-y border-white/10 bg-[#020a0b]/80 py-3 backdrop-blur-sm ${
                    isCollapsed ? 'pr-4 pl-2' : 'pr-5 pl-5 lg:pr-16 lg:pl-9'
                }`}
            >
                <UserProfileButton
                    isCollapsed={isCollapsed}
                    username={username}
                    profileImageSrc={userIconSrc}
                    onNavigate={onNavigate}
                />
                <LogoutButton isCollapsed={isCollapsed} />
            </div>
        </div>
    )
}

export default function AuthenticatedSidebar(props: AuthenticatedSidebarProps) {
    return (
        <aside
            id="marketplace-desktop-navigation"
            className={`fixed inset-y-0 left-0 z-30 isolate hidden w-(--marketplace-navigation-width) overflow-hidden transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
                props.isCollapsed
                    ? '[--marketplace-sidebar-tail:1.5rem]'
                    : '[--marketplace-sidebar-tail:5rem]'
            }`}
        >
            <SidebarSurface />
            <SidebarContent {...props} isDesktop />
        </aside>
    )
}
