import { expect, it, vi } from 'bun:test'
import { hookReact } from '../hook-harness.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { NAVBAR_ITEMS } from '@/config/navbar.config.ts'

let pathname = '/admin/users'
vi.mock('react', () => hookReact)
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
    useRouterState: ({
        select,
    }: {
        select: (state: { location: { pathname: string } }) => string
    }) => select({ location: { pathname } }),
}))
const { default: useNavigation } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedNavigation.ts')
const { default: useSidebar } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useSidebarNavigationItems.ts')
const { default: useTopbar } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedTopbarLogic.ts')

it.each([
    { permissions: [], homeTo: '/login', subtitle: 'nav.navigation' },
    {
        permissions: [PERMISSIONS.USER_DASHBOARD],
        homeTo: '/user/dashboard',
        subtitle: 'nav.user',
    },
    {
        permissions: [PERMISSIONS.ADMIN_DASHBOARD],
        homeTo: '/admin/dashboard',
        subtitle: 'nav.admin',
    },
    {
        permissions: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
        homeTo: '/admin/users',
        subtitle: 'nav.admin',
    },
])(
    'builds an authorized home route and subtitle for $homeTo',
    ({ permissions, homeTo, subtitle }) => {
        const currentPermissions: string[] = [...permissions]
        const result = useNavigation(currentPermissions).state
        expect(result.homeTo).toBe(homeTo)
        expect(result.subtitle).toBe(subtitle)
        const allRoutes = useSidebar(result.visibleNavItems, true).state
            .navigationItems
        expect(
            allRoutes.every(
                (item) =>
                    !item.permission ||
                    currentPermissions.includes(item.permission),
            ),
        ).toBe(true)
    },
)

it('keeps expanded navigation groups and flattens them for collapsed navigation', () => {
    expect(useSidebar(NAVBAR_ITEMS, false).state.navigationItems).toBe(
        NAVBAR_ITEMS,
    )
    const collapsed = useSidebar(NAVBAR_ITEMS, true).state.navigationItems
    expect(collapsed.every((item) => Boolean(item.to))).toBe(true)
    expect(collapsed.some((item) => item.to === '/admin/users')).toBe(true)
    expect(
        collapsed.some((item) => item.labelKey === 'nav.userManagement'),
    ).toBe(false)
})

it.each([
    {
        path: '/admin/users',
        title: 'admin.users.title',
        description: 'admin.users.description',
    },
    {
        path: '/user/dashboard',
        title: 'user.dashboard.title',
        description: 'user.dashboard.loggedIn',
    },
    {
        path: '/missing',
        title: 'layout.topbar.defaultTitle',
        description: 'layout.topbar.defaultDescription',
    },
])(
    'finds topbar context for $path including nested and unknown routes',
    ({ path, title, description }) => {
        pathname = path
        expect(useTopbar().state).toEqual({ title, description })
    },
)
