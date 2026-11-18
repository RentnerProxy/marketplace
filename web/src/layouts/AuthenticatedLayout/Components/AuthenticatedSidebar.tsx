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
    activeGroupKey,
    isDesktop = false,
    onNavigate,
}: SidebarContentProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useAuthenticatedSidebarLogic()

    return (
        <div
            className={`relative flex min-h-0 w-full flex-1 flex-col gap-6 pt-5 pb-1 text-[#f4f5f7] lg:pt-7 ${isDesktop ? 'marketplace-sidebar-mask' : ''}`}
        >
            <div className="px-5 lg:pr-15 lg:pl-[1.35rem]">
                <SidebarHeader
                    title={title}
                    subtitle={subtitle}
                    logoSrc={logoSrc}
                    homeTo={homeTo}
                    onNavigate={onNavigate}
                />
            </div>

            <nav
                aria-label={t('nav.navigation')}
                className={`min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto overscroll-contain ${
                    isDesktop ? 'scrollbar-none' : 'marketplace-sidebar-scroll'
                }`}
            >
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
            </nav>

            <div className="shrink-0 border-y border-white/10 bg-[#020a0b]/80 px-5 py-3 backdrop-blur-sm lg:pr-16 lg:pl-9">
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

export default function AuthenticatedSidebar({
    isCollapsed,
    ...sidebar
}: AuthenticatedSidebarProps) {
    if (isCollapsed) return <aside id="marketplace-desktop-navigation" hidden />

    return (
        <aside
            id="marketplace-desktop-navigation"
            className="fixed inset-y-0 left-0 z-30 isolate hidden w-(--marketplace-navigation-width) overflow-hidden [--marketplace-sidebar-tail:5rem] lg:flex"
        >
            <SidebarSurface />
            <SidebarContent {...sidebar} isDesktop />
        </aside>
    )
}
