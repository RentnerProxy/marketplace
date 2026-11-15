import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type {
    LoginFormValues,
    LoginRequestValues,
} from '@/features/Auth/Login/Types/login-form.types.ts'
import { getContext } from '@/integrations/TanstackQuery/root-provider.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import type {
    LoginHookFormOptions,
    LoginHookMutationObserver,
    LoginHookMutationOptions,
    LoginHookMutationResult,
} from './login-hooks.test.types.ts'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
let queryClient = getContext().queryClient
let stateCursor = 0
let refCursor = 0
let mutationCursor = 0
const stateCells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const observers: Array<LoginHookMutationObserver> = []
const observerDisposers: Array<() => void> = []
const mutationPromises: Array<Promise<LoginHookMutationResult>> = []
const navigationChecks: Array<boolean> = []
let formOptions: LoginHookFormOptions | undefined
const fixturePassword = 'synthetic-login-password'
const fixtureCode = '123456'
const form = {
    state: {
        values: { username: 'fixture-user', password: fixturePassword },
    },
    setFieldValue(field: keyof LoginFormValues, value: string) {
        form.state.values = { ...form.state.values, [field]: value }
    },
    async handleSubmit() {
        await formOptions?.onSubmit({ value: form.state.values })
    },
}

function successfulResult(): LoginHookMutationResult {
    return {
        success: true,
        user: { id: 'fixture-user-id', permissions: [] },
        redirectTo: '/user',
    }
}

const mocks = {
    navigate: vi.fn(async function () {}),
    toast: vi.fn(),
    appError: vi.fn(),
    login: vi.fn(async function (_options: {
        data: LoginRequestValues
    }): Promise<unknown> {
        return successfulResult()
    }),
    beginPasskey: vi.fn(async function () {
        return {
            challengeId: 'synthetic-challenge-id',
            options: { challenge: 'synthetic-challenge' },
        }
    }),
    finishPasskey: vi.fn(async function (): Promise<unknown> {
        return successfulResult()
    }),
    startAuthentication: vi.fn(async () => ({ id: 'synthetic-assertion' })),
}

vi.mock('react', () => ({
    ...actualReactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in stateCells)) stateCells[index] = initial
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
}))
vi.mock('@tanstack/react-form', () => ({
    useForm(options: LoginHookFormOptions) {
        formOptions = options
        return form
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => queryClient,
    useMutation(options: LoginHookMutationOptions) {
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
        const currentObserver = observer
        return {
            ...observer.getCurrentResult(),
            mutate(variable?: unknown) {
                const result = currentObserver.mutate(variable)
                mutationPromises.push(result)
                void result.catch(function () {})
            },
        }
    },
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: {
        error: mocks.toast,
        info: mocks.toast,
        success: mocks.toast,
        warning: mocks.toast,
    },
}))
vi.mock('@/lib/Errors/appError.ts', () => ({
    AppError: Error,
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: mocks.appError,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: mocks.login,
    beginPasskeyLoginHandler: mocks.beginPasskey,
    finishPasskeyLoginHandler: mocks.finishPasskey,
}))
vi.mock('@simplewebauthn/browser', () => ({
    browserSupportsWebAuthn: () => true,
    startAuthentication: mocks.startAuthentication,
}))
vi.mock('@/features/Auth/Login/Hooks/useLoginRedirectToast.ts', () => ({
    default() {},
}))
vi.mock('@/lib/Restore/restoreReturnPath.ts', () => ({
    consumePermittedRestoreReturnPath: () => null,
}))

import useLoginLogic from '@/features/Auth/Login/Hooks/useLoginLogic.ts'

function renderHook() {
    stateCursor = 0
    refCursor = 0
    mutationCursor = 0
    return useLoginLogic()
}

function unmount() {
    for (const dispose of observerDisposers.splice(0)) dispose()
}

function lastMutation() {
    const promise = mutationPromises.at(-1)
    if (!promise) throw new Error('A login mutation was expected')
    return promise
}

function submitSecondFactor(hook: ReturnType<typeof useLoginLogic>) {
    Reflect.apply(hook.handler.handleTwoFactorSubmit, undefined, [
        { preventDefault() {}, stopPropagation() {} },
    ])
}

async function prepareSecondFactor() {
    let hook = renderHook()
    mocks.login.mockResolvedValueOnce({
        success: false,
        requiresTwoFactor: true,
    })
    await form.handleSubmit()
    await lastMutation()
    hook = renderHook()
    expect(hook.state.requiresTwoFactor).toBe(true)
    expect(form.state.values.password === fixturePassword).toBe(true)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(observers[0]?.getCurrentResult().variables).toBeUndefined()
    hook.handler.handleTwoFactorChange([...fixtureCode])
    hook.setter.setTrustThisDevice(true)
    return renderHook()
}

beforeEach(function () {
    vi.clearAllMocks()
    stateCells.length = 0
    refs.length = 0
    observers.length = 0
    observerDisposers.length = 0
    mutationPromises.length = 0
    navigationChecks.length = 0
    formOptions = undefined
    form.state.values = {
        username: 'fixture-user',
        password: fixturePassword,
    }
    queryClient = getContext().queryClient
    mocks.login.mockResolvedValue(successfulResult())
    mocks.finishPasskey.mockResolvedValue(successfulResult())
    mocks.navigate.mockImplementation(async function () {
        const twoFactorCleared = stateCells.every(function (value) {
            return Array.isArray(value)
                ? value.every((digit: unknown) => digit === '')
                : value === false
        })
        navigationChecks.push(
            form.state.values.password === '' && twoFactorCleared,
        )
    })
})

afterEach(function () {
    unmount()
    for (const mutation of queryClient.getMutationCache().getAll())
        mutation.destroy()
    queryClient.clear()
    vi.restoreAllMocks()
})

describe('login authentication mutation lifecycle', function () {
    it.each(['password', 'passkey'] as const)(
        'clears the previous account cache before %s login navigation',
        async function (method) {
            queryClient.setQueryData(['notifications'], ['private-marker-A'])
            queryClient.setQueryData(['current-user-passkeys'], ['passkey-A'])
            mocks.navigate.mockImplementation(async function () {
                expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
            })
            const hook = renderHook()
            if (method === 'password') await form.handleSubmit()
            else hook.handler.handlePasskeyLogin()
            await lastMutation()
            expect(mocks.navigate).toHaveBeenCalledTimes(1)
        },
    )

    it.each([
        { method: 'password', outcome: 'success', unmountPending: false },
        { method: 'password', outcome: 'error', unmountPending: false },
        { method: 'password', outcome: 'success', unmountPending: true },
        { method: 'password', outcome: 'error', unmountPending: true },
        { method: 'passkey', outcome: 'success', unmountPending: false },
        { method: 'passkey', outcome: 'error', unmountPending: false },
        { method: 'passkey', outcome: 'success', unmountPending: true },
        { method: 'passkey', outcome: 'error', unmountPending: true },
    ] as const)(
        'cleans $method $outcome with pending unmount=$unmountPending',
        async function ({ method, outcome, unmountPending }) {
            const hook = await prepareSecondFactor()
            const pending = Promise.withResolvers<LoginHookMutationResult>()
            if (method === 'password') {
                mocks.login.mockImplementation(() => pending.promise)
                submitSecondFactor(hook)
            } else {
                mocks.finishPasskey.mockImplementation(() => pending.promise)
                hook.handler.handlePasskeyLogin()
            }
            await flushSessionActivityTasks()
            const cache = queryClient.getMutationCache()
            expect(cache.getAll()).toHaveLength(1)
            expect(cache.getAll()[0]?.state.status).toBe('pending')
            expect(
                cache.getAll()[0]?.meta?.discardAuthSecretsAfterSettled,
            ).toBe(true)
            expect(cache.getAll()[0]?.options.gcTime).not.toBe(0)
            expect(form.state.values.password === fixturePassword).toBe(true)
            expect(mocks.navigate).not.toHaveBeenCalled()
            if (method === 'password') {
                const sent = mocks.login.mock.calls.at(-1)?.[0].data
                expect(sent?.password === fixturePassword).toBe(true)
                expect(sent?.twoFactorCode === fixtureCode).toBe(true)
                expect(sent?.trustThisDevice).toBe(true)
            } else {
                expect(mocks.beginPasskey).toHaveBeenCalledTimes(1)
                expect(mocks.startAuthentication).toHaveBeenCalledTimes(1)
                expect(mocks.finishPasskey).toHaveBeenCalledTimes(1)
            }
            if (unmountPending) unmount()
            expect(cache.getAll()).toHaveLength(1)

            if (outcome === 'success') pending.resolve(successfulResult())
            else pending.reject(new Error('synthetic-login-failure'))
            await lastMutation().catch(function () {})

            expect(cache.getAll()).toHaveLength(0)
            for (const observer of observers) {
                const current = observer.getCurrentResult()
                expect(current.status).toBe('idle')
                expect(current.variables).toBeUndefined()
                expect(current.data).toBeUndefined()
                expect(current.error).toBeNull()
            }
            const serialized = JSON.stringify(
                actualQueryExports.dehydrate(queryClient, {
                    shouldDehydrateMutation: () => true,
                }),
            )
            expect(serialized.includes(fixturePassword)).toBe(false)
            expect(serialized.includes(fixtureCode)).toBe(false)
            expect(serialized.includes('synthetic-challenge')).toBe(false)
            expect(form.state.values.username).toBe('fixture-user')
            if (outcome === 'success') {
                expect(navigationChecks).toEqual([true])
                expect(form.state.values.password).toBe('')
            } else {
                expect(navigationChecks).toEqual([])
                expect(form.state.values.password === fixturePassword).toBe(
                    true,
                )
            }
        },
    )

    it('preserves password and OTP for another required second-factor attempt', async function () {
        const hook = await prepareSecondFactor()
        mocks.login.mockResolvedValueOnce({
            success: false,
            requiresTwoFactor: true,
            error: 'synthetic-invalid-two-factor',
        })
        submitSecondFactor(hook)
        await lastMutation()
        const current = renderHook()

        expect(current.state.requiresTwoFactor).toBe(true)
        expect(current.state.isTwoFactorError).toBe(true)
        expect(current.state.twoFactorCode.join('') === fixtureCode).toBe(true)
        expect(current.state.trustThisDevice).toBe(true)
        expect(form.state.values.password === fixturePassword).toBe(true)
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        expect(observers[0]?.getCurrentResult().variables).toBeUndefined()
        expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('rejects an incomplete second-factor code before calling the login handler', async function () {
        const hook = await prepareSecondFactor()
        hook.handler.handleTwoFactorChange(['1', '2', '', '', '', ''])

        submitSecondFactor(renderHook())

        expect(mocks.login).toHaveBeenCalledTimes(1)
        expect(mocks.toast).toHaveBeenCalledWith(
            'auth.login.twoFactorCodeIncomplete',
            { title: 'common.error' },
        )
        expect(renderHook().state.isTwoFactorError).toBe(true)
    })

    it.each(['password', 'passkey'] as const)(
        'cleans a rejected %s response without clearing the unfinished form',
        async function (method) {
            const hook = await prepareSecondFactor()
            const rejection: LoginHookMutationResult = {
                success: false,
                error: 'synthetic-rejection',
            }
            if (method === 'password') {
                mocks.login.mockResolvedValueOnce(rejection)
                submitSecondFactor(hook)
            } else {
                mocks.finishPasskey.mockResolvedValueOnce(rejection)
                hook.handler.handlePasskeyLogin()
            }
            await lastMutation()

            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
            expect(form.state.values.password === fixturePassword).toBe(true)
            expect(mocks.appError).toHaveBeenCalledTimes(1)
            expect(mocks.navigate).not.toHaveBeenCalled()
            for (const observer of observers)
                expect(observer.getCurrentResult().status).toBe('idle')
        },
    )

    it.each(['password', 'passkey'] as const)(
        'rejects a missing %s response without exposing a TypeError',
        async function (method) {
            const hook = renderHook()
            if (method === 'password') {
                mocks.login.mockResolvedValueOnce(undefined)
                await form.handleSubmit()
            } else {
                mocks.finishPasskey.mockResolvedValueOnce(undefined)
                hook.handler.handlePasskeyLogin()
            }

            await expect(lastMutation()).rejects.toThrow(
                method === 'password'
                    ? 'auth.login.failed'
                    : 'auth.login.passkeyFailed',
            )
            expect(mocks.navigate).not.toHaveBeenCalled()
            expect(form.state.values.password === fixturePassword).toBe(true)
            expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        },
    )
})
