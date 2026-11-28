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
import useSidebarScrollGrip from '../Hooks/useSidebarScrollGrip.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

const desktopNavigationId = 'marketplace-desktop-navigation-links'

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
    isDesktop = false,
    navigationRef,
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
                    hasCustomLogo={hasCustomLogo}
                    homeTo={homeTo}
                    onNavigate={onNavigate}
                />
            </div>

            <nav
                id={isDesktop ? desktopNavigationId : undefined}
                ref={navigationRef}
                aria-label={t('nav.navigation')}
                className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${
                    isDesktop ? 'scrollbar-none' : 'marketplace-sidebar-scroll'
                }`}
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

            <div className="shrink-0 border-t-[3px] border-dashed border-white/25 px-5 py-3 lg:pr-16 lg:pl-6">
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

function ExpandedSidebar(sidebar: AuthenticatedSidebarContentProps) {
    const { t } = useTranslationStore()
    const { state, handler, refs } = useSidebarScrollGrip()

    return (
        <aside
            id="marketplace-desktop-navigation"
            className="fixed inset-y-0 left-0 z-30 isolate hidden w-(--marketplace-navigation-width) overflow-hidden [--marketplace-sidebar-tail:5rem] lg:flex"
        >
            <SidebarSurface />
            <SidebarContent
                {...sidebar}
                navigationRef={refs.navigation}
                isDesktop
            />
            {state.position && (
                <div
                    role="scrollbar"
                    tabIndex={0}
                    aria-label={t('nav.navigation')}
                    aria-controls={desktopNavigationId}
                    aria-orientation="vertical"
                    aria-valuemin={0}
                    aria-valuemax={state.position.maxScroll}
                    aria-valuenow={Math.round(state.position.scrollTop)}
                    className="absolute z-10 flex w-6 -translate-x-1/2 cursor-grab touch-none flex-col items-center justify-center gap-1 rounded-md border-2 border-ink bg-proxy-400 shadow-[2px_2px_0_0_var(--color-ink)] select-none hover:bg-proxy-300 focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-proxy-300 active:cursor-grabbing"
                    style={state.position.style}
                    onPointerDown={handler.handlePointerDown}
                    onPointerMove={handler.handlePointerMove}
                    onLostPointerCapture={handler.handlePointerEnd}
                    onKeyDown={handler.handleKeyDown}
                >
                    <span aria-hidden="true" className="h-0.5 w-2.5 bg-ink" />
                    <span aria-hidden="true" className="h-0.5 w-2.5 bg-ink" />
                </div>
            )}
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
