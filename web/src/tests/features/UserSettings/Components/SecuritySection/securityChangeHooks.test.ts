import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { sessionConfig } from '@/config/session.config.ts'
import { getContext } from '@/integrations/TanstackQuery/root-provider.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import {
    createActivityTestClock,
    createActivityTestSession,
    flushSessionActivityTasks,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { ActivityTestServerCallOptions } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.types.ts'
import type {
    SecurityHookEffect,
    SecurityHookMutationObserver,
    SecurityHookMutationOptions,
    SecurityHookMutationResult,
    SecurityHookQueryOptions,
} from './security-change-hooks.test.types.ts'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
let queryClient = new actualQuery.QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
})
let clock = createActivityTestClock()
let language: 'de' | 'en' = 'de'
let stateCursor = 0
let refCursor = 0
let effectCursor = 0
let mutationCursor = 0
const stateCells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const effects: Array<SecurityHookEffect> = []
const observers: Array<SecurityHookMutationObserver> = []
const observerDisposers: Array<() => void> = []
const mutationPromises: Array<Promise<SecurityHookMutationResult>> = []
const queryOptions = new Map<string, SecurityHookQueryOptions>()

const mocks = {
    navigate: vi.fn(async function () {}),
    logout: vi.fn(),
    resetTheme: vi.fn(),
    toast: vi.fn(),
    read: vi.fn(async function (
        _options: ActivityTestServerCallOptions,
    ): Promise<AuthenticatedSessionQueryData> {
        return { user: null }
    }),
    beginPasskey: vi.fn(async function (): Promise<Record<string, unknown>> {
        return {
            success: true,
            challengeId: 'synthetic-challenge',
            registrationToken: 'synthetic-registration-token',
            options: { challenge: 'synthetic-challenge' },
        }
    }),
    finishPasskey: vi.fn(
        async function (): Promise<SecurityHookMutationResult> {
            return { success: true }
        },
    ),
    deletePasskey: vi.fn(
        async function (): Promise<SecurityHookMutationResult> {
            return { success: true }
        },
    ),
    beginTotp: vi.fn(async function (): Promise<SecurityHookMutationResult> {
        return {
            success: true,
            setupToken: 'synthetic-setup-proof',
            secret: 'SYNTHETICSETUPSECRET',
            otpAuthUrl: 'otpauth://totp/Synthetic?secret=SYNTHETICSETUPSECRET',
        }
    }),
    confirmTotp: vi.fn(async function (): Promise<SecurityHookMutationResult> {
        return { success: true }
    }),
    disableTotp: vi.fn(async function (): Promise<SecurityHookMutationResult> {
        return { success: true }
    }),
    getPasskeys: vi.fn(),
    getTotpStatus: vi.fn(),
}

vi.mock('react', () => ({
    ...actualReactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in stateCells))
            stateCells[index] =
                typeof initial === 'function'
                    ? Reflect.apply(initial, undefined, [])
                    : initial
        return [
            stateCells[index],
            function (value: unknown) {
                stateCells[index] =
                    typeof value === 'function'
                        ? Reflect.apply(value, undefined, [stateCells[index]])
                        : value
            },
        ]
    },
    useRef(initial: unknown) {
        const index = refCursor++
        return (refs[index] ??= { current: initial })
    },
    useEffect(
        effect: actualReact.EffectCallback,
        dependencies?: ReadonlyArray<unknown>,
    ) {
        const index = effectCursor++
        const previous = effects[index]
        const changed =
            !previous ||
            !dependencies ||
            !previous.dependencies ||
            dependencies.length !== previous.dependencies.length ||
            dependencies.some(
                (value, offset) =>
                    !Object.is(value, previous.dependencies?.[offset]),
            )
        if (changed)
            effects[index] = {
                dependencies,
                pending: effect,
                cleanup: previous?.cleanup,
            }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => queryClient,
    useQuery(options: SecurityHookQueryOptions) {
        queryOptions.set(String(options.queryKey[0]), options)
        return {
            data: queryClient.getQueryData(options.queryKey),
            isLoading: false,
        }
    },
    useMutation(options: SecurityHookMutationOptions) {
        const index = mutationCursor++
        let observer = observers[index]
        if (!observer) {
            observer = new actualQueryExports.MutationObserver(
                queryClient,
                options,
            )
            observers[index] = observer
            observerDisposers.push(observer.subscribe(function () {}))
        } else observer.setOptions(options)
        return {
            ...observer.getCurrentResult(),
            mutate(variable?: unknown) {
                const result = observer.mutate(variable)
                mutationPromises.push(result)
                void result.catch(function () {})
            },
        }
    },
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
    Link: (props: {
        to: string
        children: actualReact.ReactNode
        className?: string
    }) =>
        actualReactExports.createElement(
            'a',
            { href: props.to, className: props.className },
            props.children,
        ),
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: {
        error: mocks.toast,
        info: mocks.toast,
        success: mocks.toast,
        warning: mocks.toast,
    },
}))
vi.mock('@/features/Auth/middleware.ts', () => ({
    validateSessionHandler: mocks.read,
    logoutHandler: mocks.logout,
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({
        queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
    }),
}))
vi.mock('@/lib/Theme/appTheme.ts', () => ({
    resetAppThemeSettings: mocks.resetTheme,
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
vi.mock('@simplewebauthn/browser', () => ({
    browserSupportsWebAuthn: () => true,
    startRegistration: async () => ({ id: 'synthetic-credential' }),
}))
vi.mock('@/features/UserSettings/middleware.ts', () => ({
    beginCurrentUserPasskeyRegistrationHandler: mocks.beginPasskey,
    finishCurrentUserPasskeyRegistrationHandler: mocks.finishPasskey,
    deleteCurrentUserPasskeyHandler: mocks.deletePasskey,
    getCurrentUserPasskeysHandler: mocks.getPasskeys,
    beginCurrentUserTwoFactorSetupHandler: mocks.beginTotp,
    confirmCurrentUserTwoFactorSetupHandler: mocks.confirmTotp,
    disableCurrentUserTwoFactorHandler: mocks.disableTotp,
    getCurrentTwoFactorStatusHandler: mocks.getTotpStatus,
}))

import usePasskeyLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasskeyLogic.ts'
import useTwoFactorLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts'
import useSecurityChangeSession from '@/features/UserSettings/Components/SecuritySection/Hooks/useSecurityChangeSession.ts'
import SecurityChangeLoginNotice from '@/features/UserSettings/Components/SecuritySection/Components/SecurityChangeLoginNotice.tsx'

function renderHook<T>(hook: () => T): T {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    mutationCursor = 0
    const result = hook()
    for (const effect of effects) {
        if (!effect.pending) continue
        effect.cleanup?.()
        const dispose = effect.pending()
        effect.cleanup = typeof dispose === 'function' ? dispose : undefined
        effect.pending = undefined
    }
    return result
}

function lastMutation(): Promise<SecurityHookMutationResult> {
    const promise = mutationPromises.at(-1)
    if (!promise)
        throw new Error('Expected a mutation triggered by the public handler')
    return promise
}

beforeEach(function () {
    vi.clearAllMocks()
    stateCells.length = 0
    refs.length = 0
    effects.length = 0
    observers.length = 0
    observerDisposers.length = 0
    mutationPromises.length = 0
    queryOptions.clear()
    language = 'de'
    clock = createActivityTestClock()
    queryClient = getContext().queryClient
    queryClient.setDefaultOptions({
        ...queryClient.getDefaultOptions(),
        queries: { gcTime: Infinity, retry: false },
    })
    queryClient.setQueryData(
        AUTHENTICATED_SESSION_QUERY_KEY,
        createActivityTestSession(),
    )
    queryClient.setQueryData(['current-user-passkeys'], {
        passkeys: [{ id: 'existing-passkey', name: 'Synthetic device' }],
    })
    queryClient.setQueryData(['current-two-factor-status'], {
        isEnabled: false,
        isSetupPending: false,
    })
    mocks.read.mockResolvedValue({ user: null })
    mocks.finishPasskey.mockResolvedValue({ success: true })
    mocks.deletePasskey.mockResolvedValue({ success: true })
    mocks.confirmTotp.mockResolvedValue({ success: true })
    mocks.disableTotp.mockResolvedValue({ success: true })
    mocks.navigate.mockResolvedValue(undefined)
    const timers = new Map<number, () => void>()
    let nextTimer = 0
    stubTestGlobal('window', {
        setTimeout(callback: () => void, delayMs: number) {
            const id = ++nextTimer
            timers.set(
                id,
                clock.schedule(function () {
                    timers.delete(id)
                    callback()
                }, delayMs),
            )
            return id
        },
        clearTimeout(id: number) {
            timers.get(id)?.()
            timers.delete(id)
        },
    })
})

afterEach(function () {
    for (const effect of effects) effect.cleanup?.()
    for (const dispose of observerDisposers) dispose()
    queryClient.clear()
    vi.restoreAllMocks()
    restoreTestGlobals()
})

describe('Successful factor changes require fresh authentication without protected refetches', function () {
    it.each(['add', 'delete'] as const)(
        'clears the passkey proof before the %s success validates the session',
        async function (operation) {
            const pending =
                Promise.withResolvers<AuthenticatedSessionQueryData>()
            mocks.read.mockImplementation(() => pending.promise)
            const invalidations = vi.spyOn(queryClient, 'invalidateQueries')
            let hook = renderHook(usePasskeyLogic)
            hook.handler.handleReauthenticationValueChange('synthetic-password')
            hook = renderHook(usePasskeyLogic)
            if (operation === 'add') hook.handler.handleAddPasskey()
            else hook.handler.handleDeletePasskey('existing-passkey')
            const result = lastMutation()
            await flushSessionActivityTasks()
            await flushSessionActivityTasks()
            hook = renderHook(usePasskeyLogic)
            expect(hook.state.reauthenticationValue).toBe('')
            expect(hook.state.isReauthenticationRequired).toBe(true)
            expect(hook.state.isReauthenticationReady).toBe(false)
            expect(hook.state.passkeys).toEqual([])
            expect(queryOptions.get('current-user-passkeys')?.enabled).toBe(
                false,
            )
            expect(invalidations).not.toHaveBeenCalled()
            expect(mocks.getPasskeys).not.toHaveBeenCalled()
            expect(mocks.read).toHaveBeenCalledTimes(1)
            expect(mocks.navigate).not.toHaveBeenCalled()
            pending.resolve({ user: null })
            expect(await result).toEqual({ success: true })
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            for (const observer of observers)
                expect(observer.getCurrentResult().status).toBe('idle')
            expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' })
            expect(mocks.logout).not.toHaveBeenCalled()
            expect(invalidations).not.toHaveBeenCalled()
        },
    )

    it('clears all setup drafts and the secret mutation result before confirmed TOTP activation checks the session', async function () {
        const invalidations = vi.spyOn(queryClient, 'invalidateQueries')
        let hook = renderHook(useTwoFactorLogic)
        hook.handler.handleTwoFactorReauthenticationValueChange(
            'synthetic-password',
        )
        hook = renderHook(useTwoFactorLogic)
        hook.handler.handleStartTwoFactorSetup()
        await lastMutation()
        hook = renderHook(useTwoFactorLogic)
        expect(hook.state.twoFactorSecret).toBe('SYNTHETICSETUPSECRET')
        expect(hook.state.twoFactorOtpAuthUrl).toContain('SYNTHETICSETUPSECRET')
        expect(observers[0]?.getCurrentResult().data).toBeUndefined()
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        invalidations.mockClear()
        hook.handler.handleTwoFactorTokenChange('123456')
        hook = renderHook(useTwoFactorLogic)
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        mocks.read.mockImplementation(() => pending.promise)
        hook.handler.handleConfirmTwoFactorSetup()
        const result = lastMutation()
        await flushSessionActivityTasks()
        hook = renderHook(useTwoFactorLogic)
        expect(hook.state.twoFactorSecret).toBeNull()
        expect(hook.state.twoFactorOtpAuthUrl).toBeNull()
        expect(hook.state.twoFactorToken).toBe('')
        expect(hook.state.twoFactorReauthenticationValue).toBe('')
        expect(hook.state.copySecret).toBe(false)
        expect(hook.state.isReauthenticationRequired).toBe(true)
        expect(queryOptions.get('current-two-factor-status')?.enabled).toBe(
            false,
        )
        expect(invalidations).not.toHaveBeenCalled()
        expect(mocks.getTotpStatus).not.toHaveBeenCalled()
        expect(mocks.read).toHaveBeenCalledTimes(1)
        pending.resolve({ user: null })
        expect(await result).toEqual({ success: true })
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        for (const observer of observers)
            expect(observer.getCurrentResult().status).toBe('idle')
        expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' })
        expect(mocks.logout).not.toHaveBeenCalled()
        expect(
            mocks.toast.mock.calls.some(
                (call) => call[0] === de.toast.twoFactorEnabled,
            ),
        ).toBe(true)
    })

    it('clears the TOTP disable proof and validates without refetching protected status', async function () {
        queryClient.setQueryData(['current-two-factor-status'], {
            isEnabled: true,
            isSetupPending: false,
        })
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        mocks.read.mockImplementation(() => pending.promise)
        const invalidations = vi.spyOn(queryClient, 'invalidateQueries')
        let hook = renderHook(useTwoFactorLogic)
        hook.handler.handleTwoFactorReauthenticationValueChange('654321')
        hook = renderHook(useTwoFactorLogic)
        expect(hook.state.reauthenticationMethod).toBe('totp')
        hook.handler.handleDisableTwoFactor()
        const result = lastMutation()
        await flushSessionActivityTasks()
        hook = renderHook(useTwoFactorLogic)
        expect(hook.state.twoFactorReauthenticationValue).toBe('')
        expect(hook.state.twoFactorSecret).toBeNull()
        expect(hook.state.twoFactorOtpAuthUrl).toBeNull()
        expect(hook.state.isReauthenticationRequired).toBe(true)
        expect(queryOptions.get('current-two-factor-status')?.enabled).toBe(
            false,
        )
        expect(invalidations).not.toHaveBeenCalled()
        pending.resolve({ user: null })
        expect(await result).toEqual({ success: true })
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        for (const observer of observers)
            expect(observer.getCurrentResult().status).toBe('idle')
        expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' })
        expect(mocks.logout).not.toHaveBeenCalled()
    })

    it.each(['add', 'delete'] as const)(
        'does not transition or refetch after a rejected passkey %s',
        async function (operation) {
            mocks.finishPasskey.mockResolvedValue({
                success: false,
                error: 'rejected',
            })
            mocks.deletePasskey.mockResolvedValue({
                success: false,
                error: 'rejected',
            })
            const invalidations = vi.spyOn(queryClient, 'invalidateQueries')
            let hook = renderHook(usePasskeyLogic)
            hook.handler.handleReauthenticationValueChange('synthetic-password')
            hook = renderHook(usePasskeyLogic)
            if (operation === 'add') hook.handler.handleAddPasskey()
            else hook.handler.handleDeletePasskey('existing-passkey')
            expect(await lastMutation()).toEqual({
                success: false,
                error: 'rejected',
            })
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            hook = renderHook(usePasskeyLogic)
            expect(hook.state.isReauthenticationRequired).toBe(false)
            expect(mocks.read).not.toHaveBeenCalled()
            expect(mocks.navigate).not.toHaveBeenCalled()
            expect(invalidations).not.toHaveBeenCalled()
        },
    )

    it('retains a saved-success login hint and blocked factor queries when the fresh auth request is offline', async function () {
        mocks.read.mockRejectedValue(new Error('offline'))
        let hook = renderHook(usePasskeyLogic)
        hook.handler.handleReauthenticationValueChange('synthetic-password')
        hook = renderHook(usePasskeyLogic)
        hook.handler.handleDeletePasskey('existing-passkey')
        expect(await lastMutation()).toEqual({ success: true })
        hook = renderHook(usePasskeyLogic)
        expect(hook.state.isReauthenticationRequired).toBe(true)
        expect(hook.state.reauthenticationValue).toBe('')
        expect(queryOptions.get('current-user-passkeys')?.enabled).toBe(false)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.logout).not.toHaveBeenCalled()
        expect(mocks.read).toHaveBeenCalledTimes(1)
        hook.handler.handleAddPasskey()
        hook.handler.handleDeletePasskey('existing-passkey')
        expect(mutationPromises).toHaveLength(1)
        expect(clock.pending.size).toBe(0)
    })
})

describe('Security change session transition lifecycle', function () {
    it('bounds an abort-ignoring auth read and leaves the login hint without destroying current auth', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        mocks.read.mockImplementation(() => pending.promise)
        const original =
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            )
        const hook = renderHook(useSecurityChangeSession)
        const result = hook.handler.completeSecurityChange()
        await flushSessionActivityTasks()
        await clock.advance(sessionConfig.activityRequestTimeoutMs)
        await result
        expect(
            renderHook(useSecurityChangeSession).state
                .isReauthenticationRequired,
        ).toBe(true)
        expect(mocks.read.mock.calls[0]?.[0].signal.aborted).toBe(true)
        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            ),
        ).toBe(original)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.logout).not.toHaveBeenCalled()
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('keeps a freshly validated new login and re-enables the security panel', async function () {
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        mocks.read.mockResolvedValue(newer)
        const hook = renderHook(useSecurityChangeSession)
        await hook.handler.completeSecurityChange()
        const current = renderHook(useSecurityChangeSession)
        expect(current.state.isReauthenticationRequired).toBe(false)
        expect(current.state.hasCurrentSession).toBe(true)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.logout).not.toHaveBeenCalled()
    })

    it('releases the old panel lock when the same user has a newer login during validation', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        mocks.read.mockImplementation(() => pending.promise)
        const hook = renderHook(useSecurityChangeSession)
        const result = hook.handler.completeSecurityChange()
        await flushSessionActivityTasks()
        expect(
            renderHook(useSecurityChangeSession).state
                .isReauthenticationRequired,
        ).toBe(true)
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        queryClient.setQueryData(AUTHENTICATED_SESSION_QUERY_KEY, newer)
        expect(
            renderHook(useSecurityChangeSession).state
                .isReauthenticationRequired,
        ).toBe(false)
        await result
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            ),
        ).toEqual(newer)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.logout).not.toHaveBeenCalled()
    })

    it('does not navigate on a late inactive result after the security panel unmounted', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        mocks.read.mockImplementation(() => pending.promise)
        const hook = renderHook(useSecurityChangeSession)
        const result = hook.handler.completeSecurityChange()
        await flushSessionActivityTasks()
        for (const effect of effects) effect.cleanup?.()
        pending.resolve({ user: null })
        await result
        expect(mocks.read.mock.calls[0]?.[0].signal.aborted).toBe(true)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.logout).not.toHaveBeenCalled()
    })

    it.each(['de', 'en'] as const)(
        'renders a clear saved-change notice and login link in %s',
        function (locale) {
            language = locale
            const text = locale === 'de' ? de : en
            const html = renderToStaticMarkup(
                actualReactExports.createElement(SecurityChangeLoginNotice),
            )
            expect(html).toContain('role="status"')
            expect(html).toContain('href="/login"')
            expect(html).toContain(
                text.userSettings.security.signInAgainAllDevices,
            )
            expect(html).toContain(text.userSettings.security.signInAgain)
            expect(text.toast.twoFactorEnabled).toContain(
                locale === 'de'
                    ? 'nächsten neuen 2FA-Code'
                    : 'next new 2FA code',
            )
        },
    )
})
