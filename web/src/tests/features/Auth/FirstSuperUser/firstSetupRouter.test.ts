import * as actualRouter from '@tanstack/react-router'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, dehydrate } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createResetTestBrowser as createSetupTestBrowser } from '../PasswordReset/password-reset.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { getFirstSetupTokenHandoff } from '@/lib/Auth/FirstSuperUser/firstSetupTokenHandoff.ts'
import { getPasswordResetTokenHandoff } from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'
import { isFirstSuperUserSetupPath } from '@/features/Auth/FirstSuperUser/setupAccess.ts'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'

const actualRouterExports = { ...actualRouter }
const root = actualRouter.createRootRoute()
const setup = actualRouter.createRoute({
    getParentRoute: () => root,
    path: '/setup',
})
const reset = actualRouter.createRoute({
    getParentRoute: () => root,
    path: '/password-reset',
})
const login = actualRouter.createRoute({
    getParentRoute: () => root,
    path: '/login',
})
const routeTree = root.addChildren([setup, reset, login])
let queryClient: QueryClient
let language: 'de' | 'en' = 'de'
const histories: Array<ReturnType<typeof actualRouter.createBrowserHistory>> =
    []
const beforeContext: Array<string> = []
const beforeRouter: Array<string> = []
const nonce = Buffer.alloc(32, 7).toString('base64url')
const fixtureToken = 'A'.repeat(43)
const mocks = {
    create: vi.fn(),
    status: vi.fn(async () => ({ isRequired: true })),
    navigate: vi.fn(async function () {}),
    cspNonce: vi.fn(() => nonce),
}

function currentLocation() {
    return typeof window === 'undefined'
        ? 'without-window'
        : window.location.pathname +
              window.location.search +
              window.location.hash
}

vi.mock('@/routeTree.gen', () => ({ routeTree }))
vi.mock('@/lib/Security/cspNonce.ts', () => ({
    getRouterCspNonce: mocks.cspNonce,
}))
vi.mock('@/integrations/TanstackQuery/root-provider.ts', () => ({
    getContext() {
        beforeContext.push(currentLocation())
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } },
        })
        return { queryClient }
    },
}))
vi.mock('@tanstack/react-router-ssr-query', () => ({
    setupRouterSsrQueryIntegration: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
    ...actualRouterExports,
    useNavigate: () => mocks.navigate,
    createRouter(...args: Parameters<typeof actualRouter.createRouter>) {
        beforeRouter.push(currentLocation())
        const history =
            typeof window === 'undefined'
                ? actualRouterExports.createMemoryHistory({
                      initialEntries: ['/setup'],
                  })
                : actualRouterExports.createBrowserHistory({ window })
        histories.push(history)
        return actualRouterExports.createRouter({
            ...args[0],
            history,
            isServer: typeof window === 'undefined',
            scrollRestoration: false,
        })
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t(key: string) {
            const value = key
                .split('.')
                .reduce<unknown>(
                    (current, part) =>
                        typeof current === 'object' && current !== null
                            ? Reflect.get(current, part)
                            : undefined,
                    language === 'de' ? de : en,
                )
            return typeof value === 'string' ? value : key
        },
    }),
}))
vi.mock('@/features/Auth/FirstSuperUser/middleware.ts', () => ({
    createFirstSuperUserAccountHandler: mocks.create,
    getFirstSuperUserSetupStatusHandler: mocks.status,
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => ({ queryKey: ['fixture-settings'] }),
}))

import { getRouter } from '@/router.tsx'
import { Route as setupFileRoute } from '@/routes/setup.tsx'
import FirstSuperUser from '@/features/Auth/FirstSuperUser/index.tsx'

beforeEach(function () {
    vi.clearAllMocks()
    histories.length = 0
    beforeContext.length = 0
    beforeRouter.length = 0
    language = 'de'
    queryClient = new QueryClient()
    mocks.status.mockResolvedValue({ isRequired: true })
})

afterEach(function () {
    for (const history of histories) history.destroy()
    queryClient.clear()
    restoreTestGlobals()
})

describe('first setup router and SSR boundary', function () {
    it.each([
        '/setup',
        '/SETUP',
        '/Setup/',
        '/s%65tup',
        '//setup',
        '///%73etup///',
        '/setup////',
    ])(
        'captures before QueryClient and router for alias %s',
        async function (path) {
            const { browser } = createSetupTestBrowser(
                path + '?access=ignored#access=' + fixtureToken,
            )
            const initialState = browser.history.state
            stubTestGlobal('window', browser)
            const router = getRouter()

            expect(beforeContext).toEqual(['/setup'])
            expect(beforeRouter).toEqual(['/setup'])
            expect(browser.history.state).toBe(initialState)
            expect(router.latestLocation.pathname).toBe('/setup')
            expect(router.latestLocation.hash).toBe('')
            expect(router.latestLocation.search).toEqual({})
            expect(router.options.ssr?.nonce).toBe(nonce)
            expect(mocks.cspNonce).toHaveBeenCalledTimes(1)
            await router.load()
            const [, params, found] = router.getMatchedRoutes(
                router.latestLocation.pathname,
            )
            expect(found?.id).toBe('/setup')
            expect(params['**']).toBeUndefined()
            expect(JSON.stringify(router.state).includes(fixtureToken)).toBe(
                false,
            )
            expect(
                JSON.stringify(router.latestLocation).includes(fixtureToken),
            ).toBe(false)
            expect(
                JSON.stringify(dehydrate(queryClient)).includes(fixtureToken),
            ).toBe(false)
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            expect(mocks.create).not.toHaveBeenCalled()
            const transfer = getFirstSetupTokenHandoff(browser)?.take()
            expect(
                transfer?.status === 'captured' &&
                    transfer.token === fixtureToken,
            ).toBe(true)
        },
    )

    it.each([
        '/setup',
        '/SETUP',
        '/Setup/',
        '/s%65tup',
        '//setup',
        '///%73etup///',
        '/setup////',
        '/setup%2F',
        '/%2Fsetup',
        '/%2573etup',
        '/%',
        '/se%ZZtup',
        '/setup/extra',
        '/setup%0A',
        '/setup%0D',
    ])(
        'agrees with actual complete router matching for path case %#',
        function (path) {
            const history = actualRouterExports.createMemoryHistory({
                initialEntries: [path],
            })
            histories.push(history)
            const router = actualRouterExports.createRouter({
                routeTree,
                history,
                isServer: true,
            })
            const [, params, found] = router.getMatchedRoutes(
                router.latestLocation.pathname,
            )
            const completeMatch = found?.id === '/setup' && !params['**']
            expect(isFirstSuperUserSetupPath(path)).toBe(completeMatch)
        },
    )

    it('never accepts a query token and removes it before router state', function () {
        const { browser } = createSetupTestBrowser(
            '/setup?access=' + fixtureToken,
        )
        stubTestGlobal('window', browser)
        const router = getRouter()
        expect(beforeContext).toEqual(['/setup'])
        expect(router.latestLocation.search).toEqual({})
        expect(
            JSON.stringify(router.latestLocation).includes(fixtureToken),
        ).toBe(false)
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'missing',
        })
    })

    it('discards setup access before navigating away', function () {
        const { browser } = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        )
        stubTestGlobal('window', browser)
        const router = getRouter()
        router.emit({
            type: 'onBeforeNavigate',
            fromLocation: router.latestLocation,
            toLocation: router.buildLocation({ to: '/login' }),
            pathChanged: true,
            hrefChanged: true,
            hashChanged: false,
        })
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
    })

    it('keeps the existing password-reset capture before both consumers', function () {
        const { browser } = createSetupTestBrowser(
            '/password-reset#token=synthetic-reset-fixture',
        )
        stubTestGlobal('window', browser)
        const router = getRouter()
        expect(beforeContext).toEqual(['/password-reset'])
        expect(beforeRouter).toEqual(['/password-reset'])
        expect(router.latestLocation.hash).toBe('')
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-reset-fixture',
        })
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
    })

    it('stops before QueryClient or router construction if sanitizing fails', function () {
        const { browser } = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        )
        browser.history.replaceState = function () {
            throw new Error('synthetic history failure')
        }
        stubTestGlobal('window', browser)
        expect(() => getRouter()).toThrow('Unable to clear the first setup URL')
        expect(beforeContext).toHaveLength(0)
        expect(beforeRouter).toHaveLength(0)
        expect(mocks.cspNonce).not.toHaveBeenCalled()
    })

    it.each(['de', 'en'] as const)(
        'renders checking without window or any secret during %s SSR',
        function (locale) {
            language = locale
            stubTestGlobal('window', undefined)
            const router = getRouter()
            const html = renderToStaticMarkup(createElement(FirstSuperUser))
            const text = locale === 'de' ? de : en
            expect(beforeContext).toEqual(['without-window'])
            expect(beforeRouter).toEqual(['without-window'])
            expect(html).toContain(text.auth.firstSetup.checkingSetupLink)
            expect(html).not.toContain('<form')
            expect(html).not.toContain('setupToken')
            expect(html.includes(fixtureToken)).toBe(false)
            expect(mocks.create).not.toHaveBeenCalled()
            expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            expect(router.latestLocation.hash).toBe('')
        },
    )

    it('retains the existing completed-installation redirect', async function () {
        expect(setupFileRoute.options.validateSearch).toBeUndefined()
        const beforeLoad = setupFileRoute.options.beforeLoad
        if (!beforeLoad) throw new Error('The setup route guard is required')
        mocks.status.mockResolvedValue({ isRequired: false })
        let caught: unknown
        try {
            await Reflect.apply(beforeLoad, undefined, [
                { location: { pathname: '/setup' } },
            ])
        } catch (error) {
            caught = error
        }
        expect(actualRouterExports.isRedirect(caught)).toBe(true)
        if (!actualRouterExports.isRedirect(caught))
            throw new Error('Redirect was expected')
        expect(caught.options.to).toBe('/login')
        expect(mocks.create).not.toHaveBeenCalled()
    })
})
