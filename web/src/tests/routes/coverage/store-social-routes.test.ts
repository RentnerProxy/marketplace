import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

type Loaded = Record<string, string> | undefined
type RouteArgs = {
    context: { queryClient: typeof client }
    params: Record<string, string>
}
type Head = { meta?: Array<Record<string, string>> }
type Options = {
    component?: () => ReactNode
    notFoundComponent?: () => ReactNode
    errorComponent?: unknown
    beforeLoad?: (args: RouteArgs) => unknown
    loader?: (args: RouteArgs) => Promise<Loaded>
    head?: (args: { loaderData?: Loaded }) => Head
    validateSearch?: { parse: (search: unknown) => unknown }
    server?: {
        handlers: Record<
            'GET' | 'HEAD',
            (args: {
                request: Request
                params: Record<string, string>
            }) => unknown
        >
    }
}

const routes = new Map<string, Options>()
let loaderData: Record<string, string> = {}
let routeParams: Record<string, string> = {}
let routeContext: Record<string, string> = {}
const client = {
    ensureQueryData: mock(
        async (_options: {
            queryKey: ReadonlyArray<string>
        }): Promise<Record<string, string> | null> => null,
    ),
}
const authenticate = mock(
    async (): Promise<{ user: { id: string } | null }> => ({
        user: { id: 'reviewer-1' },
    }),
)
const bannerResponse = new Response('banner')
const serveBanner = mock(
    async (_request: Request, _userId: string) => bannerResponse,
)

function notFound() {
    return Object.assign(new Error('Not found'), { isNotFound: true })
}
function redirect(options: { to: string }) {
    return Object.assign(new Error(`Redirect to ${options.to}`), {
        to: options.to,
    })
}
function RouteErrorComponent() {
    return createElement('aside', null, 'Route error')
}

mock.module('@tanstack/react-router', () => ({
    createFileRoute: (path: string) => (options: Options) => {
        routes.set(path, options)
        return {
            options,
            useLoaderData: () => loaderData,
            useParams: () => routeParams,
            useRouteContext: () => routeContext,
        }
    },
    notFound,
    redirect,
}))
mock.module('@/lib/AppStore/appStoreQueries.ts', () => ({
    appDetailQueryOptions: (appId: string) => ({
        queryKey: ['app-store', 'detail', appId],
    }),
}))
mock.module('@/lib/Social/socialQueries.ts', () => ({
    publicProfileQueryOptions: (username: string) => ({
        queryKey: ['social', 'profile', username],
    }),
}))
mock.module('@/lib/Routes/routeGuards.ts', () => ({
    requireAuthenticatedRoute: authenticate,
}))
mock.module('@/server/Social/banner.service.ts', () => ({
    handlePublicProfileBannerService: serveBanner,
}))
mock.module('@/shared/RouteErrorComponent/RouteErrorComponent.tsx', () => ({
    RouteErrorComponent,
}))
mock.module('@/layouts/PublicLayout/index.tsx', () => ({
    default: ({ children }: { children?: ReactNode }) =>
        createElement('main', null, 'Public shell', children),
}))
mock.module('@/features/AppStore/Detail/index.tsx', () => ({
    default: ({ appId }: { appId: string }) =>
        createElement('article', null, `App detail ${appId}`),
}))
mock.module(
    '@/features/AppStore/Detail/Components/AppDetailNotFound.tsx',
    () => ({
        default: () => createElement('section', null, 'App not found'),
    }),
)
mock.module('@/features/AppStore/Editor/index.tsx', () => ({
    default: ({ appId }: { appId: string }) =>
        createElement('form', null, `Store editor ${appId}`),
}))
mock.module('@/features/PublicProfile/index.tsx', () => ({
    default: ({ username }: { username: string }) =>
        createElement('article', null, `Profile ${username}`),
}))
mock.module(
    '@/features/PublicProfile/Components/PublicProfileNotFound.tsx',
    () => ({
        default: () => createElement('section', null, 'Profile not found'),
    }),
)
mock.module(
    '@/features/Marketplace/Components/SubmissionQueue/index.tsx',
    () => ({
        SubmissionQueue: ({ mode, userId }: { mode: string; userId: string }) =>
            createElement('table', null, `Queue ${mode} ${userId}`),
    }),
)

await import('@/routes/apps_/$appId.tsx')
await import('@/routes/u/$username.tsx')
await import('@/routes/_authenticated/user/app-submissions_.$appId.tsx')
await import('@/routes/_authenticated/admin/app-reviews.tsx')
await import('@/routes/api/profiles/$userId/banner.ts')

const appId = 'rentner.weather-widget'

function route(path: string) {
    const options = routes.get(path)
    if (!options) throw new Error(`Missing captured route ${path}`)
    return options
}
function args(params: Record<string, string>): RouteArgs {
    return { context: { queryClient: client }, params }
}
function render(component: (() => ReactNode) | undefined) {
    if (!component) throw new Error('Missing route component')
    return renderToStaticMarkup(createElement(component))
}

beforeEach(() => {
    client.ensureQueryData.mockReset().mockResolvedValue(null)
    authenticate.mockReset().mockResolvedValue({ user: { id: 'reviewer-1' } })
    serveBanner.mockClear()
    loaderData = {}
    routeParams = {}
    routeContext = {}
})

describe('public app detail route', () => {
    it('rejects malformed app ids before loading any data', async () => {
        await expect(
            route('/apps_/$appId').loader!(args({ appId: 'Not An App' })),
        ).rejects.toMatchObject({ isNotFound: true })
        expect(client.ensureQueryData).not.toHaveBeenCalled()
    })

    it('treats an unpublished app as not found', async () => {
        await expect(
            route('/apps_/$appId').loader!(args({ appId })),
        ).rejects.toMatchObject({ isNotFound: true })
        expect(client.ensureQueryData).toHaveBeenCalledWith({
            queryKey: ['app-store', 'detail', appId],
        })
    })

    it('loads only the fields needed for the page head and component', async () => {
        client.ensureQueryData.mockResolvedValue({
            appId,
            name: 'Wetter',
            summary: 'Zeigt das Wetter.',
            license: 'MIT',
        })
        await expect(
            route('/apps_/$appId').loader!(args({ appId })),
        ).resolves.toEqual({
            appId,
            name: 'Wetter',
            summary: 'Zeigt das Wetter.',
        })
    })

    it('describes the app in the head and keeps it out of search indexes', () => {
        const options = route('/apps_/$appId')
        expect(options.head!({})).toEqual({})
        expect(
            options.head!({
                loaderData: {
                    appId,
                    name: 'Wetter',
                    summary: 'Zeigt das Wetter.',
                },
            }).meta,
        ).toEqual([
            { title: `Wetter · ${PROJECT_CONFIG.defaultName}` },
            { name: 'description', content: 'Zeigt das Wetter.' },
            { name: 'robots', content: 'noindex, nofollow, nosnippet' },
        ])
    })

    it('renders the detail page and its not-found page in the public shell', () => {
        loaderData = { appId }
        const page = render(route('/apps_/$appId').component)
        expect(page).toContain('Public shell')
        expect(page).toContain(`App detail ${appId}`)
        const missing = render(route('/apps_/$appId').notFoundComponent)
        expect(missing).toContain('Public shell')
        expect(missing).toContain('App not found')
    })
})

describe('public profile route', () => {
    it('accepts only known profile tabs and drops unknown ones', () => {
        const search = route('/u/$username').validateSearch!
        expect(search.parse({ tab: 'followers' })).toEqual({ tab: 'followers' })
        expect(search.parse({ tab: 'apps' })).toEqual({ tab: 'apps' })
        expect(search.parse({ tab: 'secrets' })).toEqual({ tab: undefined })
    })

    it('treats an unknown username as not found', async () => {
        await expect(
            route('/u/$username').loader!(args({ username: 'ghost' })),
        ).rejects.toMatchObject({ isNotFound: true })
        expect(client.ensureQueryData).toHaveBeenCalledWith({
            queryKey: ['social', 'profile', 'ghost'],
        })
    })

    it('uses the canonical username of the loaded profile', async () => {
        client.ensureQueryData.mockResolvedValue({ username: 'Kevin' })
        await expect(
            route('/u/$username').loader!(args({ username: 'kevin' })),
        ).resolves.toEqual({ username: 'Kevin' })
    })

    it('names the profile in the head without allowing indexing', () => {
        const options = route('/u/$username')
        expect(options.head!({})).toEqual({})
        expect(
            options.head!({ loaderData: { username: 'Kevin' } }).meta,
        ).toEqual([
            { title: `Kevin · ${PROJECT_CONFIG.defaultName}` },
            {
                name: 'description',
                content: `Kevin · ${PROJECT_CONFIG.defaultName}`,
            },
            { name: 'robots', content: 'noindex, nofollow, nosnippet' },
        ])
    })

    it('renders the profile and its not-found page in the public shell', () => {
        loaderData = { username: 'Kevin' }
        const page = render(route('/u/$username').component)
        expect(page).toContain('Public shell')
        expect(page).toContain('Profile Kevin')
        const missing = render(route('/u/$username').notFoundComponent)
        expect(missing).toContain('Public shell')
        expect(missing).toContain('Profile not found')
    })
})

describe('store editor route', () => {
    it('only opens the editor for well-formed app ids', () => {
        const options = route('/_authenticated/user/app-submissions_/$appId')
        expect(() => options.beforeLoad!(args({ appId: '../admin' }))).toThrow(
            'Not found',
        )
        expect(options.beforeLoad!(args({ appId }))).toBeUndefined()
        expect(options.errorComponent).toBe(RouteErrorComponent)
    })

    it('passes the route app id to the store editor', () => {
        routeParams = { appId }
        expect(
            render(
                route('/_authenticated/user/app-submissions_/$appId').component,
            ),
        ).toContain(`Store editor ${appId}`)
    })
})

describe('app review route', () => {
    it('provides the signed-in reviewer as actor for the review queue', async () => {
        const options = route('/_authenticated/admin/app-reviews')
        await expect(options.beforeLoad!(args({}))).resolves.toEqual({
            actorId: 'reviewer-1',
        })
        routeContext = { actorId: 'reviewer-1' }
        expect(render(options.component)).toContain('Queue review reviewer-1')
        expect(options.errorComponent).toBe(RouteErrorComponent)
    })

    it('sends visitors without a user back to the login', async () => {
        authenticate.mockResolvedValue({ user: null })
        await expect(
            route('/_authenticated/admin/app-reviews').beforeLoad!(args({})),
        ).rejects.toMatchObject({ to: '/login' })
    })
})

describe('public profile banner route', () => {
    it.each(['GET', 'HEAD'] as const)(
        'serves %s requests through the banner service for the requested user',
        async (method) => {
            const request = new Request(
                'https://market.rentner.dev/api/profiles/user-1/banner',
                { method },
            )
            const handler = route('/api/profiles/$userId/banner').server!
                .handlers[method]
            await expect(
                handler({ request, params: { userId: 'user-1' } }),
            ).resolves.toBe(bannerResponse)
            expect(serveBanner).toHaveBeenCalledWith(request, 'user-1')
        },
    )
})
