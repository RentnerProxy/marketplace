import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement, Fragment, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Home } from 'lucide-react'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

const action = vi.fn()
const saveThemeMode = vi.fn()
let collapsed = false
let savingTheme = false
let loggingOut = false
let requesting = false
let minimized = false
let mobileOpen = false
const navItems: AuthenticatedNavItem[] = [
    { labelKey: 'nav.dashboard', to: '/user/dashboard', icon: Home },
]
let publicRegistrationEnabled = false
vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: { isPublicRegistrationEnabled: publicRegistrationEnabled },
    }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => ({}),
}))
vi.mock('@tanstack/react-router', () => ({
    Outlet: () => createElement('article', null, 'Route content'),
    Link: ({
        to,
        children,
        className,
        'aria-label': label,
    }: {
        to: string
        children: ReactNode
        className?: string
        'aria-label'?: string
    }) =>
        createElement(
            'a',
            { href: to, 'aria-label': label, className },
            children,
        ),
}))
vi.mock('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) =>
        createElement(Fragment, null, children),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedSidebarLogic.ts',
    () => ({
        default: () => ({
            state: {
                openGroups: {},
                isLoggingOut: loggingOut,
            },
            handler: {
                handleLogout: action,
                handleToggleGroup: action,
                handleOpenUserSettings: action,
            },
        }),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedPageHeaderLogic.ts',
    () => ({
        default: () => ({
            state: {
                title: 'Dashboard title',
                description: 'Your overview',
                groupKey: 'nav.admin',
                eyebrow: 'Admin',
            },
        }),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useMaintenanceBannerLogic.ts',
    () => ({
        default: () => ({
            state: {
                reason: 'Finishing a task',
                isRequestingMaintenanceExtension: requesting,
            },
            handler: {
                handleRequestMaintenanceExtension: action,
                handleReasonChange: action,
            },
        }),
    }),
)
vi.mock('@/shared/Images/Hooks/useResolvedImageSrc.ts', () => ({
    default: (src: string) => ({
        state: { imageSrc: src },
        handler: { handleImageError: action },
    }),
}))
vi.mock('@/features/Notifications/Components/NotificationMenu.tsx', () => ({
    default: () => createElement('button', null, 'Notifications'),
}))
vi.mock('@/features/UserSettings/index.tsx', () => ({
    default: () => createElement('div', null, 'User settings dialog'),
}))
vi.mock('@/features/UserSettings/Hooks/useThemeModeMutation.ts', () => ({
    default: () => ({
        state: { isSavingThemeMode: savingTheme },
        handler: { saveThemeMode },
    }),
}))
vi.mock('@/shared/Hooks/useModalDialogLogic.ts', () => ({
    default: ({ isOpen }: { isOpen: boolean }) => ({
        state: { shouldRender: isOpen },
        handler: { handleCancel: action },
        refs: { dialogRef: null, closeButtonRef: null },
    }),
}))
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useMobileNavigationLogic.ts',
    () => ({
        default: () => ({
            state: { isOpen: mobileOpen },
            handler: { handleOpen: action, handleClose: action },
        }),
    }),
)
vi.mock(
    '@/features/Admin/Backups/Components/BackupCreationProgressBridge.tsx',
    () => ({
        default: () => createElement('div', null, 'Backup progress bridge'),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellLogic.ts',
    () => ({
        default: () => ({
            state: {
                themeMode: collapsed ? 'light' : 'dark',
                shellStyle: {},
                isCollapsed: collapsed,
                companyName: 'Company',
                navigationSubtitle: 'Overview',
                systemLogoSrc: '/logo.png',
                homeTo: '/user/dashboard',
                visibleNavItems: navItems,
                username: 'Kevin',
                profileImageSrc64: '/profile.png',
                showMaintenanceBanner: true,
                isMaintenanceBannerMinimized: minimized,
                millisecondsUntilMaintenance: 60000,
                pendingMaintenanceExtensionRequest: {
                    user: { id: 'user-1', username: 'Kevin' },
                },
                userId: 'user-1',
                canManageBackups: true,
            },
            handler: {
                expandMaintenanceBanner: action,
                minimizeMaintenanceBanner: action,
                toggleCollapse: action,
            },
        }),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useSocialLinkedRedirect.ts',
    () => ({ default: () => undefined }),
)
vi.mock('@/layouts/PublicLayout/Hooks/useFooterLogic.ts', () => ({
    default: () => ({
        state: {
            companyName: 'Example Company',
            currentYear: 2026,
            appVersion: '1.2.3',
        },
    }),
}))
vi.mock('@/layouts/PublicLayout/Components/LanguageSwitcher.tsx', () => ({
    default: () =>
        createElement(
            'button',
            { 'aria-label': 'Language selector' },
            'Deutsch',
        ),
}))
const { default: Main } =
    await import('@/layouts/AuthenticatedLayout/Components/AuthenticatedMain.tsx')
const { default: Sidebar } =
    await import('@/layouts/AuthenticatedLayout/Components/AuthenticatedSidebar.tsx')
const { default: Topbar } =
    await import('@/layouts/AuthenticatedLayout/Components/AuthenticatedTopbar.tsx')
const { default: ThemeModeSwitch } =
    await import('@/layouts/AuthenticatedLayout/Components/ThemeModeSwitch.tsx')
const { default: Banner } =
    await import('@/layouts/AuthenticatedLayout/Components/MaintenanceBanner.tsx')
const { default: NavigationItem } =
    await import('@/layouts/AuthenticatedLayout/Components/NavigationItem.tsx')
const { default: Footer } =
    await import('@/layouts/PublicLayout/Components/Footer.tsx')
const { default: PublicLayout } =
    await import('@/layouts/PublicLayout/index.tsx')
const { default: AuthenticatedShell } =
    await import('@/layouts/AuthenticatedLayout/index.tsx')

function callbacks(
    node: ReactNode,
    name: string,
): ((...args: unknown[]) => unknown)[] {
    if (Array.isArray(node))
        return node.flatMap((child) => callbacks(child, name))
    if (!isValidElement<Record<string, unknown>>(node)) return []
    const own =
        typeof node.props[name] === 'function'
            ? [node.props[name] as (...args: unknown[]) => unknown]
            : []
    return [...own, ...callbacks(node.props.children as ReactNode, name)]
}
beforeEach(() => {
    vi.clearAllMocks()
    publicRegistrationEnabled = false
    collapsed = false
    savingTheme = false
    loggingOut = false
    requesting = false
    minimized = false
    mobileOpen = false
})

it.each([false, true])(
    'renders the sticky topbar and navigation controls when collapsed=%s',
    (isCollapsed) => {
        const main = renderToStaticMarkup(
            createElement(Main, {
                eyebrow: 'Admin',
                title: 'Dashboard title',
                description: 'Your overview',
            }),
        )
        expect(main).toContain('Route content')
        expect(main).toContain('>Dashboard title</h1>')
        expect(main).toContain('>Your overview</p>')
        expect(main).toContain('>Admin</p>')
        expect(main).toContain('sm:px-6 2xl:px-8')
        expect(main).not.toContain('max-w-360')
        const top = renderToStaticMarkup(
            createElement(Topbar, {
                isCollapsed,
                isMobileNavigationOpen: false,
                themeMode: isCollapsed ? 'light' : 'dark',
                showMaintenanceCountdown: isCollapsed,
                millisecondsUntilMaintenance: 60000,
                onToggleCollapse: action,
                onOpenMobileNavigation: action,
                onExpandMaintenanceBanner: action,
            }),
        )
        expect(top).toContain('sticky top-0')
        expect(top).toContain('aria-controls="marketplace-mobile-navigation"')
        expect(top).toContain(
            `aria-controls="marketplace-desktop-navigation" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'nav.expand' : 'nav.collapse'}"`,
        )
        expect(top).not.toContain('Dashboard title')
        expect(top).not.toContain('<h1')
        expect(top).toContain('Notifications')
        expect(top).toContain(
            `role="switch" aria-label="userSettings.theme.dark" aria-checked="${!isCollapsed}"`,
        )
        expect(top.indexOf('role="switch"')).toBeLessThan(
            top.indexOf('Notifications'),
        )
        expect(top.includes('maintenance.expandBanner')).toBe(isCollapsed)
    },
)

it.each([false, true])(
    'fully hides sidebar identity and navigation with collapsed=%s',
    (isCollapsed) => {
        loggingOut = true
        const html = renderToStaticMarkup(
            createElement(Sidebar, {
                title: 'Company',
                subtitle: 'Overview',
                logoSrc: '/logo.png',
                hasCustomLogo: true,
                homeTo: '/user/dashboard',
                navItems,
                username: 'Kevin',
                userIconSrc: '/profile.png',
                isCollapsed,
                activeGroupKey: null,
            }),
        )
        if (isCollapsed) {
            expect(html).toBe(
                '<aside id="marketplace-desktop-navigation" hidden=""></aside>',
            )
            return
        }

        expect(html).toContain('--marketplace-sidebar-tail:5rem')
        expect(html).toContain('marketplace-sidebar-mask comic-dark')
        expect(html).toContain('src="/logo.png"')
        expect(html).toContain('aria-label="nav.navigation"')
        expect(html).toContain('href="/user/dashboard"')
        expect(html).toContain('aria-[current=page]:bg-proxy-400')
        expect(html).toContain('alt="Kevin"')
        expect(html).toContain('nav.profile')
        expect(html).toContain('common.loggingOut')
        expect(html).toContain('disabled=""')
    },
)

it('toggles visible navigation groups independently of desktop visibility', () => {
    const item: AuthenticatedNavItem = {
        labelKey: 'nav.user',
        icon: Home,
        children: navItems,
    }
    const props = {
        item,
        activeGroupKey: item.labelKey,
        openGroups: {},
        onToggleGroup: action,
    }
    expect(
        renderToStaticMarkup(createElement(NavigationItem, props)),
    ).toContain('nav.dashboard')
    expect(
        renderToStaticMarkup(createElement(NavigationItem, props)),
    ).toContain('comic-lettering')
    expect(
        renderToStaticMarkup(createElement(NavigationItem, props)),
    ).toContain('data-active="true"')
    const tree = NavigationItem(props)
    callbacks(tree, 'onClick')[0]?.()
    expect(action).toHaveBeenCalledWith('nav.user')
    expect(
        renderToStaticMarkup(
            createElement(NavigationItem, {
                ...props,
                openGroups: { 'nav.user': false },
            }),
        ),
    ).not.toContain('nav.dashboard')
    expect(
        NavigationItem({
            ...props,
            item: { labelKey: 'nav.overview', icon: Home },
        }),
    ).toBeNull()
})

it.each([
    ['dark', 'light'],
    ['light', 'dark'],
] as const)(
    'saves the opposite theme from %s and ignores a pending save',
    (themeMode, nextThemeMode) => {
        callbacks(ThemeModeSwitch({ themeMode }), 'onClick')[0]?.()
        expect(saveThemeMode).toHaveBeenCalledWith(nextThemeMode)

        savingTheme = true
        const pending = ThemeModeSwitch({ themeMode })
        expect(renderToStaticMarkup(pending)).toContain('aria-disabled="true"')
        callbacks(pending, 'onClick')[0]?.()
        expect(saveThemeMode).toHaveBeenCalledTimes(1)
    },
)

it('renders a maintenance form and forwards a prevented submit', () => {
    const props = {
        millisecondsUntilMaintenance: 60000,
        isOwnRequestPending: false,
        onMinimize: action,
    }
    const html = renderToStaticMarkup(createElement(Banner, props))
    expect(html).toContain('<form')
    expect(html).toContain('minLength="10"')
    expect(html).toContain('maintenance.minimizeBanner')
    const preventDefault = vi.fn()
    callbacks(Banner(props), 'onSubmit')[0]?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
    requesting = true
    expect(renderToStaticMarkup(createElement(Banner, props))).toContain(
        'maintenance.requestSent',
    )
})

it.each([false, true])(
    'shows a pending maintenance request without a duplicate form, own=%s',
    (isOwnRequestPending) => {
        const html = renderToStaticMarkup(
            createElement(Banner, {
                millisecondsUntilMaintenance: 60000,
                pendingUsername: 'Kevin',
                isOwnRequestPending,
                onMinimize: action,
            }),
        )
        expect(html).not.toContain('<form')
        expect(html).toContain(
            isOwnRequestPending
                ? 'maintenance.pendingOwnRequest'
                : 'maintenance.pendingRequest',
        )
    },
)

it('keeps legal navigation and version in the footer while language selection is in the header', () => {
    const html = renderToStaticMarkup(createElement(PublicLayout))
    expect(html).toContain('Route content')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/imprint"')
    expect(html).toContain('2026 Example Company')
    expect(html).toContain('Language selector')
    expect(html).toContain('1.2.3')
    const footerHtml = renderToStaticMarkup(createElement(Footer))
    expect(footerHtml).not.toContain('Language selector')
    expect(footerHtml).not.toContain('aria-pressed')
    expect(footerHtml).not.toContain('href="#main-content"')
})

it.each([false, true])(
    'composes the authenticated shell with maintenance and backup progress, minimized=%s',
    (isMinimized) => {
        minimized = isMinimized
        collapsed = isMinimized
        const html = renderToStaticMarkup(createElement(AuthenticatedShell))
        expect(html).toContain(
            isMinimized ? 'app-theme-light' : 'app-theme-dark',
        )
        expect(html).toContain('marketplace-signed-in')
        expect(html).toContain(
            isMinimized
                ? '--marketplace-navigation-width:0px'
                : '--marketplace-navigation-width:19rem',
        )
        expect(html).not.toContain('background-image:')
        expect(html).toContain('Backup progress bridge')
        expect(html).not.toContain('User settings dialog')
        expect(html).toContain('Route content')
        expect(html.includes('maintenance.pendingOwnRequest')).toBe(
            !isMinimized,
        )
        expect(html.includes('maintenance.expandBanner')).toBe(isMinimized)
    },
)

it('offers expanded mobile navigation even when the desktop rail is collapsed', () => {
    mobileOpen = true
    collapsed = true
    const html = renderToStaticMarkup(createElement(AuthenticatedShell))
    expect(html).toContain(
        'aria-controls="marketplace-mobile-navigation" aria-expanded="true"',
    )
    expect(html).toContain('<dialog id="marketplace-mobile-navigation"')
    expect(html).toContain('id="marketplace-mobile-navigation-title"')
    expect(html).toContain('>nav.dashboard</span>')
    expect(html).toContain('nav.profile')
})

it('uses the Marketplace wordmark for default branding', () => {
    const sidebar = {
        title: 'RentnerProxy Marketplace',
        subtitle: 'Overview',
        logoSrc: '/images/default.webp',
        homeTo: '/user/dashboard' as const,
        navItems,
        username: 'Kevin',
        userIconSrc: '/profile.png',
        activeGroupKey: null,
    }
    const expanded = renderToStaticMarkup(
        createElement(Sidebar, { ...sidebar, isCollapsed: false }),
    )
    expect(expanded).toContain('/brand/head-blink')
    expect(expanded).toContain('aria-label="RentnerProxy Marketplace"')
})

it.each([false, true])(
    'shows the public signup link only while registration is enabled (%s)',
    (enabled) => {
        publicRegistrationEnabled = enabled
        const html = renderToStaticMarkup(createElement(PublicLayout))
        expect(html.includes('href="/register"')).toBe(enabled)
        expect(html).toContain('href="/login"')
    },
)
