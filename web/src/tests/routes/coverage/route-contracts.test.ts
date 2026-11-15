import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    elements,
    findElement,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

type RouteContext = {
    context: { queryClient: typeof client }
    location: { pathname: string }
}
type Options = {
    component?: () => ReactNode
    shellComponent?: (props: { children: ReactNode }) => ReactNode
    beforeLoad?: (args: RouteContext) => unknown
    loader?: (args: RouteContext) => unknown
    validateSearch?: (search: unknown) => unknown
    head?: () => {
        meta: Array<Record<string, string>>
        links: Array<Record<string, string>>
    }
}
const routes = new Map<string, Options>()
const client = {
    ensureQueryData: mock(async (_options: unknown) => ({
        companyName: 'Example',
    })),
}
const session = { user: { id: 'member-1' }, permissions: ['user.dashboard'] }
const authenticate = mock(async (_pathname: string) => session)
const permission = mock(async (_client: unknown, _pathname: string) => {})
const cacheSession = mock()
const queryOptions = { queryKey: ['system-settings'] }
let setupRequired = false
let hash = ''
const setupStatus = mock(async () => ({ isRequired: setupRequired }))
const routerState = mock(
    ({
        select,
    }: {
        select: (state: { location: { hash: string } }) => string
    }) => select({ location: { hash } }),
)
function routeFactory(path: string) {
    return (options: Options) => {
        routes.set(path, options)
        return { options }
    }
}
function redirect(options: { to: string }) {
    return Object.assign(new Error(`Redirect to ${options.to}`), {
        to: options.to,
    })
}
function Provider({ children }: { children?: ReactNode }) {
    return createElement('div', null, children)
}
const LoginPage = ({ redirectReason }: { redirectReason?: string }) =>
    createElement('main', { 'data-reason': redirectReason }, 'Login screen')

mock.module('@tanstack/react-router', () => ({
    createFileRoute: routeFactory,
    createRootRouteWithContext: () => routeFactory('__root'),
    redirect,
    useRouterState: routerState,
    Outlet: () => createElement('main', null, 'Route outlet'),
    HeadContent: () => createElement('meta', { name: 'route-head' }),
    Scripts: () => createElement('script', { src: '/router.js' }),
}))
mock.module('@/lib/Routes/routeGuards.ts', () => ({
    requireAuthenticatedRoute: authenticate,
    requireConfiguredPermissionRouteFromQueryClient: permission,
}))
mock.module('@/lib/Queries/authenticatedSessionCache.ts', () => ({
    setAuthenticatedSessionQueryData: cacheSession,
}))
mock.module('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => queryOptions,
}))
mock.module('@/features/Auth/FirstSuperUser/middleware.ts', () => ({
    getFirstSuperUserSetupStatusHandler: setupStatus,
}))
mock.module('@/layouts/AuthenticatedLayout/index.tsx', () => ({
    default: () => createElement('main', null, 'Authenticated shell'),
}))
mock.module('@/layouts/PublicLayout/index.tsx', () => ({
    default: ({ children }: { children?: ReactNode }) =>
        createElement('main', null, 'Public shell', children),
}))
mock.module('@/features/MarketplaceHome/index.tsx', () => ({
    default: () => createElement('section', null, 'Marketplace screen'),
}))
mock.module('@/features/MarketplaceApps/index.tsx', () => ({
    default: () => createElement('section', null, 'Marketplace apps screen'),
}))
mock.module('@/features/MarketplaceBlog/index.tsx', () => ({
    default: () => createElement('section', null, 'Marketplace blog screen'),
}))
mock.module('@/features/Auth/Login/index.tsx', () => ({ default: LoginPage }))
mock.module('@/features/Auth/FirstSuperUser/index.tsx', () => ({
    default: () => createElement('main', null, 'Setup screen'),
}))
mock.module('@/features/Maintenance/index.tsx', () => ({
    default: () => createElement('main', null, 'Maintenance screen'),
}))
mock.module('@/shared/RouteErrorComponent/RouteErrorComponent.tsx', () => ({
    RouteErrorComponent: () => createElement('aside', null, 'Route error'),
}))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'de', t: (key: string) => key }),
}))
mock.module('@/styles.css?url', () => ({ default: '/assets/app.css' }))
mock.module('@/shared/TransferOverlay/index.tsx', () => ({
    default: () => createElement('aside', { 'aria-label': 'Transfers' }),
}))
mock.module('@tanstack/react-router-devtools', () => ({
    TanStackRouterDevtoolsPanel: () => null,
}))
mock.module('@tanstack/react-devtools', () => ({
    TanStackDevtools: () => null,
}))
mock.module('@/integrations/TanstackQuery/devtools.tsx', () => ({
    default: { name: 'Query tools' },
}))
mock.module('@rentnerkev/calendar', () => ({ CalendarProvider: Provider }))
mock.module('@rentnerkev/inputs', () => ({ InputProvider: Provider }))
mock.module('@rentnerkev/select', () => ({ SelectProvider: Provider }))
mock.module('@rentnerkev/toasts', () => ({ ToastProvider: Provider }))
mock.module('@rentnerkev/tooltips', () => ({ TooltipProvider: Provider }))

await import('@/routes/__root.tsx')
await import('@/routes/_authenticated/route.tsx')
await import('@/routes/_authenticated/admin/route.tsx')
await import('@/routes/_authenticated/user/route.tsx')
await import('@/routes/_authenticated/user/dashboard.tsx')
await import('@/routes/_public/route.tsx')
await import('@/routes/_public/login.tsx')
await import('@/routes/_public/maintenance.tsx')
await import('@/routes/index.tsx')
await import('@/routes/apps.tsx')
await import('@/routes/blog.tsx')
await import('@/routes/setup.tsx')

function route(path: string) {
    const options = routes.get(path)
    if (!options) throw new Error(`Missing captured route ${path}`)
    return options
}
const params = (pathname: string): RouteContext => ({
    context: { queryClient: client },
    location: { pathname },
})

beforeEach(() => {
    client.ensureQueryData.mockClear()
    authenticate.mockReset().mockResolvedValue(session)
    permission.mockReset().mockResolvedValue(undefined)
    cacheSession.mockClear()
    setupRequired = false
    setupStatus.mockClear()
    hash = ''
})

describe('Thin route boundary contracts', () => {
    it('hydrates the authenticated session cache and ensures system settings after authentication', async () => {
        await route('/_authenticated').beforeLoad?.(params('/user/dashboard'))
        expect(authenticate).toHaveBeenCalledWith('/user/dashboard')
        expect(cacheSession).toHaveBeenCalledWith(client, session)
        expect(client.ensureQueryData).toHaveBeenCalledWith(queryOptions)
        expect(
            renderToStaticMarkup(
                createElement(route('/_authenticated').component!),
            ),
        ).toContain('Authenticated shell')
    })

    it('propagates denied authentication before populating cache or loading settings', async () => {
        const denied = new Error('Sign in required')
        authenticate.mockRejectedValue(denied)
        await expect(
            route('/_authenticated').beforeLoad?.(params('/admin/users')),
        ).rejects.toBe(denied)
        expect(cacheSession).not.toHaveBeenCalled()
        expect(client.ensureQueryData).not.toHaveBeenCalled()
    })

    it.each(['admin', 'user'])(
        'checks configured permissions for the %s branch using the current path',
        async (branch) => {
            const options = route(`/_authenticated/${branch}`)
            await options.beforeLoad?.(params(`/${branch}/dashboard`))
            expect(permission).toHaveBeenCalledWith(
                client,
                `/${branch}/dashboard`,
            )
            const denied = new Error('Permission denied')
            permission.mockRejectedValue(denied)
            await expect(
                options.beforeLoad?.(params(`/${branch}/dashboard`)),
            ).rejects.toBe(denied)
            expect(
                renderToStaticMarkup(createElement(options.component!)),
            ).toContain('Route outlet')
        },
    )

    it('renders the translated user dashboard heading and authenticated message', () => {
        const html = renderToStaticMarkup(
            createElement(route('/_authenticated/user/dashboard').component!),
        )
        expect(html).toContain('<h1')
        expect(html).toContain('user.dashboard.title')
        expect(html).toContain('user.dashboard.loggedIn')
    })

    it('redirects public visitors to required setup and otherwise loads public settings', async () => {
        const options = route('/_public')
        setupRequired = true
        await expect(
            options.beforeLoad?.(params('/login')),
        ).rejects.toMatchObject({ to: '/setup' })
        await expect(
            options.beforeLoad?.(params('/setup')),
        ).resolves.toBeUndefined()
        setupRequired = false
        await expect(
            options.beforeLoad?.(params('/login')),
        ).resolves.toBeUndefined()
        await expect(
            options.beforeLoad?.(params('/setup')),
        ).rejects.toMatchObject({ to: '/login' })
        await options.loader?.(params('/login'))
        expect(client.ensureQueryData).toHaveBeenCalledWith(queryOptions)
        expect(
            renderToStaticMarkup(createElement(options.component!)),
        ).toContain('Public shell')
    })

    it('permits first administrator setup only while required and loads its settings', async () => {
        const options = route('/setup')
        setupRequired = true
        await expect(
            options.beforeLoad?.(params('/setup')),
        ).resolves.toBeUndefined()
        setupRequired = false
        await expect(
            options.beforeLoad?.(params('/setup')),
        ).rejects.toMatchObject({ to: '/login' })
        await options.loader?.(params('/setup'))
        expect(client.ensureQueryData).toHaveBeenCalledWith(queryOptions)
        expect(
            renderToStaticMarkup(createElement(options.component!)),
        ).toContain('Setup screen')
    })

    it.each([
        '#password-reset-token-missing',
        '#password-reset-token-invalid',
        '#unrecognized',
    ])(
        'passes only recognized redirect hash %s to the login screen',
        (value) => {
            hash = value
            const tree = route('/_public/login').component!()
            const login = findElement(
                tree,
                (element) => element.type === LoginPage,
            )
            expect(login.props.redirectReason).toBe(
                value === '#unrecognized' ? undefined : value.slice(1),
            )
            expect(renderToStaticMarkup(tree)).toContain('Login screen')
        },
    )

    it('validates maintenance search and renders the maintenance screen', () => {
        const options = route('/_public/maintenance')
        expect(
            options.validateSearch?.({
                redirect: '/admin/backups',
                ignored: 'value',
            }),
        ).toEqual({ redirect: '/admin/backups' })
        expect(options.validateSearch?.({})).toEqual({})
        expect(() => options.validateSearch?.({ redirect: 123 })).toThrow()
        expect(
            renderToStaticMarkup(createElement(options.component!)),
        ).toContain('Maintenance screen')
    })

    it.each([
        { path: '/', content: 'Marketplace screen' },
        { path: '/apps', content: 'Marketplace apps screen' },
        { path: '/blog', content: 'Marketplace blog screen' },
    ])(
        'renders $path in the public shell without authentication, setup checks or data loading',
        ({ path, content }) => {
            const options = route(path)
            expect(options.beforeLoad).toBeUndefined()
            expect(options.loader).toBeUndefined()
            const html = renderToStaticMarkup(createElement(options.component!))
            expect(html).toContain('Public shell')
            expect(html).toContain(content)
            expect(authenticate).not.toHaveBeenCalled()
            expect(setupStatus).not.toHaveBeenCalled()
            expect(client.ensureQueryData).not.toHaveBeenCalled()
        },
    )

    it('declares document metadata, asset links and a localized provider shell', () => {
        const options = route('__root')
        const head = options.head!()
        expect(head.meta).toContainEqual({ charSet: 'utf-8' })
        expect(head.meta).toContainEqual({ title: PROJECT_CONFIG.defaultName })
        expect(head.meta).toContainEqual({
            name: 'viewport',
            content: 'width=device-width, initial-scale=1',
        })
        expect(head.meta).toContainEqual({
            name: 'description',
            content: `${PROJECT_CONFIG.defaultName} ${PROJECT_CONFIG.description}`,
        })
        expect(head.links).toContainEqual({
            rel: 'stylesheet',
            href: '/assets/app.css',
        })
        expect(head.links).toContainEqual({
            rel: 'icon',
            href: '/rentnerproxy-logo.png',
            type: 'image/png',
        })
        expect(head.links).toContainEqual({
            rel: 'manifest',
            href: '/manifest.json',
        })
        const shell = options.shellComponent!({
            children: createElement('main', null, 'Application content'),
        })
        expect(
            findElement(shell, (element) => element.type === 'html').props.lang,
        ).toBe('de')
        expect(
            findElement(shell, (element) => element.type === 'body').props
                .suppressHydrationWarning,
        ).toBe(true)
        const localizedProviders = elements(shell).filter(
            (element) => element.props.locale !== undefined,
        )
        expect(localizedProviders).toHaveLength(4)
        expect(
            localizedProviders.every(
                (element) => element.props.locale === 'de',
            ),
        ).toBe(true)
        expect(
            findElement(
                shell,
                (element) => element.props.messages !== undefined,
            ).props.messages,
        ).toEqual({ keyboardHelp: 'shared.calendar.keyboardHelp' })
        const html = renderToStaticMarkup(shell)
        expect(html).toContain('Application content')
        expect(html).toContain('aria-label="Transfers"')
        expect(html).toContain('src="/router.js"')
    })
})
