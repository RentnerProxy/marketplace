import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement, Fragment, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Home } from 'lucide-react'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

const action = vi.fn()
let collapsed = false
let loggingOut = false
let requesting = false
let minimized = false
let publicRegistrationEnabled = false
const navItems: AuthenticatedNavItem[] = [
    { labelKey: 'nav.home', to: '/user/dashboard', icon: Home },
]
vi.mock('@tanstack/react-router', () => ({
    Outlet: () => createElement('article', null, 'Route content'),
    Link: ({ to, children }: { to: string; children: ReactNode }) =>
        createElement('a', { href: to }, children),
}))
vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: { isPublicRegistrationEnabled: publicRegistrationEnabled },
    }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => ({}),
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
                isCollapsed: collapsed,
                openGroups: {},
                isLoggingOut: loggingOut,
            },
            handler: {
                handleLogout: action,
                handleToggleGroup: action,
                handleToggleCollapse: action,
                handleOpenUserSettings: action,
            },
        }),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useSidebarNavigationItems.ts',
    () => ({ default: () => ({ state: { navigationItems: navItems } }) }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedTopbarLogic.ts',
    () => ({
        default: () => ({
            state: { title: 'Dashboard title', description: 'Your overview' },
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
                systemLogoSrc64: '/logo.png',
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
            },
        }),
    }),
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
    collapsed = false
    loggingOut = false
    requesting = false
    minimized = false
    publicRegistrationEnabled = false
})

it.each([false, true])(
    'reserves the correct main and topbar space when collapsed=%s',
    (isCollapsed) => {
        const main = renderToStaticMarkup(
            createElement(Main, {
                isCollapsed,
                showMaintenanceBanner: isCollapsed,
            }),
        )
        expect(main).toContain(isCollapsed ? 'pl-20' : 'pl-72')
        expect(main).toContain(isCollapsed ? 'pt-44' : 'pt-24')
        expect(main).toContain('Route content')
        const top = renderToStaticMarkup(
            createElement(Topbar, {
                isCollapsed,
                showMaintenanceCountdown: isCollapsed,
                millisecondsUntilMaintenance: 60000,
                onExpandMaintenanceBanner: action,
            }),
        )
        expect(top).toContain('Dashboard title')
        expect(top).toContain('Notifications')
        expect(top.includes('maintenance.expandBanner')).toBe(isCollapsed)
    },
)

it.each([false, true])(
    'renders sidebar identity and navigation with collapsed=%s',
    (isCollapsed) => {
        collapsed = isCollapsed
        loggingOut = isCollapsed
        const html = renderToStaticMarkup(
            createElement(Sidebar, {
                title: 'Company',
                subtitle: 'Overview',
                logoSrc: '/logo.png',
                homeTo: '/user/dashboard',
                navItems,
                username: 'Kevin',
                userIconSrc: '/profile.png',
            }),
        )
        expect(html).toContain(isCollapsed ? 'w-20' : 'w-72')
        expect(html).toContain('href="/user/dashboard"')
        expect(html).toContain('alt="Kevin"')
        expect(html).toContain(isCollapsed ? 'nav.expand' : 'nav.collapse')
        expect(html.includes('userSettings.settingsLabel')).toBe(!isCollapsed)
        expect(html.includes('disabled=""')).toBe(isCollapsed)
    },
)

it('renders expanded nested navigation and only toggles groups when expanded', () => {
    const item: AuthenticatedNavItem = {
        labelKey: 'nav.group',
        icon: Home,
        children: navItems,
    }
    const props = { item, isCollapsed: false, openGroups: {} }
    expect(
        renderToStaticMarkup(createElement(NavigationItem, props)),
    ).toContain('nav.home')
    const tree = NavigationItem(props)
    callbacks(tree, 'onClick')[0]?.()
    expect(action).toHaveBeenCalledWith('nav.group')
    vi.clearAllMocks()
    callbacks(NavigationItem({ ...props, isCollapsed: true }), 'onClick')[0]?.()
    expect(action).not.toHaveBeenCalled()
    expect(
        renderToStaticMarkup(
            createElement(NavigationItem, {
                ...props,
                openGroups: { 'nav.group': false },
            }),
        ),
    ).not.toContain('nav.home')
    expect(
        NavigationItem({ ...props, item: { labelKey: 'hidden', icon: Home } }),
    ).toBeNull()
})

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
    'shows the public signup link only while registration is enabled (%s)',
    (enabled) => {
        publicRegistrationEnabled = enabled
        const html = renderToStaticMarkup(createElement(PublicLayout))
        expect(html.includes('href="/register"')).toBe(enabled)
        expect(html).toContain('href="/login"')
    },
)

it.each([false, true])(
    'composes the authenticated shell with maintenance and backup progress, minimized=%s',
    (isMinimized) => {
        minimized = isMinimized
        collapsed = isMinimized
        const html = renderToStaticMarkup(createElement(AuthenticatedShell))
        expect(html).toContain(
            isMinimized ? 'app-theme-light' : 'app-theme-dark',
        )
        expect(html).not.toContain('background-image:')
        expect(html).toContain('Backup progress bridge')
        expect(html).toContain('User settings dialog')
        expect(html).toContain('Route content')
        expect(html.includes('maintenance.pendingOwnRequest')).toBe(
            !isMinimized,
        )
        expect(html.includes('maintenance.expandBanner')).toBe(isMinimized)
    },
)
