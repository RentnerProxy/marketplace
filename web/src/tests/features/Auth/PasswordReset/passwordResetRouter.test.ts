import * as actualRouter from '@tanstack/react-router'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, dehydrate } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createResetTestBrowser } from './password-reset.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { getPasswordResetTokenHandoff } from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'

vi.mock('@/lib/Security/cspNonce.ts', () => ({
    getRouterCspNonce: () => Buffer.alloc(32, 7).toString('base64url'),
}))

const actualRouterExports = { ...actualRouter }
const root = actualRouter.createRootRoute()
const publicRoute = actualRouter.createRoute({
    getParentRoute: () => root,
    id: '_public',
})
const reset = actualRouter.createRoute({
    getParentRoute: () => publicRoute,
    path: '/password-reset',
})
const login = actualRouter.createRoute({
    getParentRoute: () => publicRoute,
    path: '/login',
})
const routeTree = root.addChildren([publicRoute.addChildren([reset, login])])
let queryClient: QueryClient
let language: 'de' | 'en' = 'de'
const histories: Array<ReturnType<typeof actualRouter.createBrowserHistory>> =
    []
const beforeRouter: Array<string> = []
const mocks = {
    validate: vi.fn(),
    update: vi.fn(),
    navigate: vi.fn(async function () {}),
}
vi.mock('@/routeTree.gen.ts', () => ({ routeTree }))
vi.mock('@/integrations/TanstackQuery/root-provider.ts', () => ({
    getContext: () => ({ queryClient }),
}))
vi.mock('@tanstack/react-router-ssr-query', () => ({
    setupRouterSsrQueryIntegration: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
    ...actualRouterExports,
    useNavigate: () => mocks.navigate,
    createRouter(...args: Parameters<typeof actualRouter.createRouter>) {
        beforeRouter.push(
            typeof window === 'undefined'
                ? 'ssr'
                : window.location.pathname +
                      window.location.search +
                      window.location.hash,
        )
        const history =
            typeof window === 'undefined'
                ? actualRouterExports.createMemoryHistory({
                      initialEntries: ['/password-reset'],
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
vi.mock('@/features/Auth/PasswordReset/middleware.ts', () => ({
    validateTokenHandler: mocks.validate,
    updatePasswordByTokenHandler: mocks.update,
}))

import { getRouter } from '@/router.tsx'
import { Route as resetFileRoute } from '@/routes/_public/password-reset.tsx'
import PasswordReset from '@/features/Auth/PasswordReset/index.tsx'

beforeEach(function () {
    vi.clearAllMocks()
    histories.length = 0
    beforeRouter.length = 0
    language = 'de'
    queryClient = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
})
afterEach(function () {
    for (const history of histories) history.destroy()
    queryClient.clear()
    restoreTestGlobals()
})

describe('Password reset router and SSR privacy boundary', function () {
    it.each([
        '/password-reset',
        '/password-reset/',
        '/Password-Reset',
        '/%70assword-reset',
        '/password%2Dreset',
        '//password-reset',
        '///PASSWORD-RESET///',
    ])(
        'removes token data before constructing and loading the real router for %s',
        async function (path) {
            const { browser } = createResetTestBrowser(
                path + '#token=synthetic-router-proof',
            )
            const originalState = browser.history.state
            stubTestGlobal('window', browser)
            const router = getRouter()
            expect(beforeRouter).toEqual(['/password-reset'])
            expect(browser.history.state).toBe(originalState)
            expect(router.latestLocation.pathname).toBe('/password-reset')
            expect(router.latestLocation.hash).toBe('')
            expect(router.latestLocation.search).toEqual({})
            await router.load()
            expect(
                router.state.matches.some(
                    (match) =>
                        match.routeId === '/_public/password-reset' &&
                        match.status === 'success',
                ),
            ).toBe(true)
            expect(JSON.stringify(router.state)).not.toContain(
                'synthetic-router-proof',
            )
            expect(JSON.stringify(router.latestLocation)).not.toContain(
                'synthetic-router-proof',
            )
            expect(JSON.stringify(dehydrate(queryClient))).not.toContain(
                'synthetic-router-proof',
            )
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            expect(mocks.validate).not.toHaveBeenCalled()
            expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
                status: 'captured',
                token: 'synthetic-router-proof',
            })
        },
    )
    it.each([
        '/%2Fpassword-reset',
        '/password-reset%2F',
        '/%2570assword-reset',
    ])(
        'does not expand reserved or doubly encoded route %s into a reset link',
        function (path) {
            const { browser } = createResetTestBrowser(
                path + '#token=synthetic-nonroute-proof',
            )
            stubTestGlobal('window', browser)
            const router = getRouter()
            expect(router.latestLocation.pathname.toLowerCase()).not.toBe(
                '/password-reset',
            )
            expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
                status: 'inactive',
            })
        },
    )
    it('discards the handoff through the actual router navigation event when leaving', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-router-proof',
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
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
    })
    it.each(['de', 'en'] as const)(
        'renders only token-free checking HTML on the server in %s',
        function (locale) {
            language = locale
            stubTestGlobal('window', undefined)
            const router = getRouter()
            const html = renderToStaticMarkup(createElement(PasswordReset))
            const text = locale === 'de' ? de : en
            expect(beforeRouter).toEqual(['ssr'])
            expect(html).toContain(text.auth.passwordReset.validating)
            expect(html).toContain('role="status"')
            expect(html).not.toContain('<form')
            expect(html).not.toContain('<input')
            expect(mocks.validate).not.toHaveBeenCalled()
            expect(mocks.update).not.toHaveBeenCalled()
            expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            expect(router.latestLocation.hash).toBe('')
        },
    )
    it('has no token search validator or beforeLoad and declares a no-referrer meta policy', function () {
        expect(resetFileRoute.options.validateSearch).toBeUndefined()
        expect(resetFileRoute.options.beforeLoad).toBeUndefined()
        const head = resetFileRoute.options.head
        if (!head) throw new Error('Expected the reset privacy head')

        expect(Reflect.apply(head, undefined, [])).toEqual({
            meta: [{ name: 'referrer', content: 'no-referrer' }],
        })
    })
})
