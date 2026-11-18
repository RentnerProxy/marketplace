import { expect, it, vi } from 'bun:test'
import { hookReact } from '../hook-harness.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

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
const { default: usePageHeader } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedPageHeaderLogic.ts')

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
        subtitle: 'nav.navigation',
    },
    {
        permissions: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
        homeTo: '/admin/users',
        subtitle: 'nav.navigation',
    },
])(
    'builds an authorized home route and subtitle for $homeTo',
    ({ permissions, homeTo, subtitle }) => {
        const currentPermissions: string[] = [...permissions]
        const result = useNavigation(currentPermissions).state
        expect(result.homeTo).toBe(homeTo)
        expect(result.subtitle).toBe(subtitle)
        const allRoutes = result.visibleNavItems.flatMap(
            (item) => item.children ?? [item],
        )
        expect(
            allRoutes.every(
                (item) =>
                    !item.permission ||
                    currentPermissions.includes(item.permission),
            ),
        ).toBe(true)
    },
)

it.each([
    {
        path: '/admin/users',
        groupKey: 'nav.staff',
        title: 'admin.users.title',
        description: 'admin.users.description',
    },
    {
        path: '/admin/dashboard',
        groupKey: 'nav.admin',
        title: 'admin.dashboard.title',
        description: 'admin.dashboard.description',
    },
    {
        path: '/user/dashboard',
        groupKey: null,
        title: 'user.dashboard.title',
        description: 'user.dashboard.loggedIn',
    },
    {
        path: '/missing',
        groupKey: null,
        title: 'layout.topbar.defaultTitle',
        description: 'layout.topbar.defaultDescription',
    },
])(
    'finds page and navigation group context for $path',
    ({ path, groupKey, title, description }) => {
        pathname = path
        expect(usePageHeader().state).toEqual({
            groupKey,
            eyebrow: groupKey,
            title,
            description,
        })
    },
)
