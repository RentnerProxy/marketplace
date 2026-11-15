import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    captureFirstSetupToken,
    getFirstSetupTokenHandoff,
} from '@/lib/Auth/FirstSuperUser/firstSetupTokenHandoff.ts'
import { FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS } from '@/config/security.config.ts'
import { createResetTestBrowser as createSetupTestBrowser } from '../PasswordReset/password-reset.test.helpers.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type {
    FirstSetupHookEffect,
    FirstSetupTestServerCall,
} from './first-setup.test.types.ts'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
const cells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const effects: Array<FirstSetupHookEffect> = []
const sentRequests: Array<FirstSetupTestServerCall> = []
const navigationChecks: Array<boolean> = []
let stateCursor = 0
let refCursor = 0
let effectCursor = 0
const fixtureToken = 'A'.repeat(43)
let testBrowser = createSetupTestBrowser('/setup#access=' + fixtureToken)
let queryClient = new actualQuery.QueryClient()
const mocks = {
    navigate: vi.fn(async function () {}),
    toast: vi.fn(),
    toastError: vi.fn(),
    create: vi.fn(async function (
        _input: FirstSetupTestServerCall,
    ): Promise<unknown> {
        return { success: true }
    }),
    mutation: vi.fn(function () {
        throw new Error('First setup must not create a cached mutation')
    }),
}

vi.mock('react', () => ({
    ...actualReactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in cells)) cells[index] = initial
        return [
            cells[index],
            function (value: unknown) {
                cells[index] =
                    typeof value === 'function'
                        ? Reflect.apply(value, undefined, [cells[index]])
                        : value
            },
        ]
    },
    useRef(initial: unknown) {
        const index = refCursor++
        return (refs[index] ??= { current: initial })
    },
    useEffect(
        setup: actualReact.EffectCallback,
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
                setup,
                dependencies,
                pending: true,
                cleanup: previous?.cleanup,
            }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useMutation: mocks.mutation,
    useQueryClient: () => queryClient,
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@rentnerkev/toasts', () => ({
    toast: {
        error: mocks.toastError,
        info: mocks.toast,
        success: mocks.toast,
        warning: mocks.toast,
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/features/Auth/FirstSuperUser/middleware.ts', () => ({
    createFirstSuperUserAccountHandler(input: FirstSetupTestServerCall) {
        sentRequests.push({ data: { ...input.data }, signal: input.signal })
        return mocks.create(input)
    },
}))

import useCreateFirstSuperUserAccountLogic from '@/features/Auth/FirstSuperUser/Hooks/useCreateFirstSuperUserAccountLogic.ts'

function renderHook(commit = true) {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    const result = useCreateFirstSuperUserAccountLogic()
    if (commit) {
        for (const effect of effects) {
            if (!effect.pending) continue
            effect.cleanup?.()
            const cleanup = effect.setup()
            effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
            effect.pending = false
        }
    }
    return result
}

function unmount() {
    for (const effect of effects) {
        effect.cleanup?.()
        effect.cleanup = undefined
    }
}

function fillForm() {
    let hook = renderHook()
    hook.setter.setFieldValue('username', 'fixture-user')
    hook.setter.setFieldValue('email', 'fixture@example.test')
    hook.setter.setFieldValue('password', 'abc')
    hook.setter.setFieldValue('confirmPassword', 'abc')
    hook = renderHook()
    return hook
}

async function submit(hook = renderHook()) {
    Reflect.apply(hook.handler.handleSubmit, undefined, [
        { preventDefault() {}, stopPropagation() {} },
    ])
    await flushSessionActivityTasks()
}

function expectPrivateState() {
    const hook = renderHook()
    expect('setupToken' in hook.state.formValues).toBe(false)
    expect(JSON.stringify({ cells, refs, hook }).includes(fixtureToken)).toBe(
        false,
    )
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(
        JSON.stringify(actualQueryExports.dehydrate(queryClient)).includes(
            fixtureToken,
        ),
    ).toBe(false)
    expect(mocks.mutation).not.toHaveBeenCalled()
}

beforeEach(function () {
    vi.clearAllMocks()
    cells.length = 0
    refs.length = 0
    effects.length = 0
    sentRequests.length = 0
    navigationChecks.length = 0
    testBrowser = createSetupTestBrowser('/setup#access=' + fixtureToken)
    captureFirstSetupToken(testBrowser.browser)
    stubTestGlobal('window', testBrowser.browser)
    queryClient = new actualQueryExports.QueryClient()
    mocks.create.mockResolvedValue({ success: true })
    mocks.navigate.mockImplementation(async function () {
        const values = cells[0]
        navigationChecks.push(
            typeof values === 'object' &&
                values !== null &&
                Reflect.get(values, 'password') === '' &&
                Reflect.get(values, 'confirmPassword') === '',
        )
    })
})

afterEach(async function () {
    unmount()
    await flushSessionActivityTasks()
    queryClient.clear()
    restoreTestGlobals()
})

describe('first setup hook secret lifecycle', function () {
    it('keeps checking during render and consumes once across StrictMode effects', async function () {
        expect(renderHook(false).state.setupAccessState).toBe('checking')
        expect(mocks.create).not.toHaveBeenCalled()
        renderHook()
        for (const effect of effects) {
            effect.cleanup?.()
            const cleanup = effect.setup()
            effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        }
        await flushSessionActivityTasks()
        expect(renderHook().state.setupAccessState).toBe('granted')
        expect(getFirstSetupTokenHandoff(testBrowser.browser)?.take()).toEqual({
            status: 'missing',
        })
        expectPrivateState()
        await submit(fillForm())
        expect(mocks.create).toHaveBeenCalledTimes(1)
        expect(sentRequests[0]?.data.setupToken === fixtureToken).toBe(true)
        expect(navigationChecks).toEqual([true])
        expect(mocks.toast).toHaveBeenCalledWith('auth.firstSetup.created', {
            title: 'auth.firstSetup.title',
        })
    })

    it.each(['/setup', '/setup?access=ignored', '/setup#access=invalid'])(
        'shows the existing missing notice for case %#',
        async function (path) {
            testBrowser = createSetupTestBrowser(path)
            captureFirstSetupToken(testBrowser.browser)
            stubTestGlobal('window', testBrowser.browser)
            renderHook()
            await flushSessionActivityTasks()
            expect(renderHook().state.setupAccessState).toBe('missing')
            expect(testBrowser.browser.location.hash).toBe('')
            expect(testBrowser.browser.location.search).toBe('')
            await submit(fillForm())
            expect(mocks.create).not.toHaveBeenCalled()
            expect(mocks.navigate).not.toHaveBeenCalled()
            expectPrivateState()
        },
    )

    it('drops an unconsumed transfer on a real unmount', async function () {
        renderHook()
        unmount()
        await flushSessionActivityTasks()
        expect(getFirstSetupTokenHandoff(testBrowser.browser)?.take()).toEqual({
            status: 'missing',
        })
        cells.length = 0
        refs.length = 0
        effects.length = 0
        renderHook()
        await flushSessionActivityTasks()
        expect(renderHook().state.setupAccessState).toBe('missing')
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('aborts a pending request and prevents navigation after unmount', async function () {
        renderHook()
        await flushSessionActivityTasks()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementation(() => pending.promise)
        await submit(fillForm())
        expect(renderHook().state.isCreating).toBe(true)
        expectPrivateState()
        unmount()
        expect(sentRequests[0]?.signal.aborted).toBe(true)
        expect(mocks.create.mock.calls[0]?.[0].data.setupToken).toBe('')
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
        expect(testBrowser.clock.pending.size).toBe(0)
    })

    it('replaces access before an old resolved response can navigate', async function () {
        renderHook()
        await flushSessionActivityTasks()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementationOnce(() => pending.promise)
        await submit(fillForm())
        const nextToken = 'B'.repeat(43)
        pending.resolve({ success: true })
        testBrowser.browser.location.hash = '#access=' + nextToken
        testBrowser.browser.dispatchEvent(new Event('hashchange'))
        expect(sentRequests[0]?.signal.aborted).toBe(true)
        await flushSessionActivityTasks()
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(renderHook().state.setupAccessState).toBe('granted')
        expect(renderHook().state.formValues.password).toBe('')
        await submit(fillForm())
        expect(sentRequests[1]?.data.setupToken === nextToken).toBe(true)
        expect(mocks.navigate).toHaveBeenCalledTimes(1)
        expect(navigationChecks).toEqual([true])
    })

    it('bounds timeout, preserves a usable retry and ignores late success', async function () {
        renderHook()
        await flushSessionActivityTasks()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementationOnce(() => pending.promise)
        await submit(fillForm())
        testBrowser.clock.advance(FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS)
        await flushSessionActivityTasks()
        const hook = renderHook()
        expect(sentRequests[0]?.signal.aborted).toBe(true)
        expect(hook.state.isCreating).toBe(false)
        expect(hook.state.setupAccessState).toBe('granted')
        expect(hook.state.formValues.password).toBe('abc')
        expect(mocks.toastError).toHaveBeenCalledWith(
            'auth.firstSetup.createError',
            { title: 'common.error' },
        )
        expectPrivateState()
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.navigate).not.toHaveBeenCalled()
        await submit()
        expect(mocks.navigate).toHaveBeenCalledTimes(1)
    })

    it('preserves the invalid access error and prevents another request', async function () {
        renderHook()
        await flushSessionActivityTasks()
        mocks.create.mockResolvedValue({
            success: false,
            errorCode: 'invalid_setup_token',
        })
        await submit(fillForm())
        expect(renderHook().state.setupAccessState).toBe('missing')
        expect(renderHook().state.formValues.password).toBe('')
        expect(mocks.toastError).toHaveBeenCalledWith(
            'auth.firstSetup.invalidSetupToken',
            { title: 'common.error' },
        )
        expect(mocks.navigate).not.toHaveBeenCalled()
        await submit(fillForm())
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })

    it('preserves the already completed notice and login navigation', async function () {
        renderHook()
        await flushSessionActivityTasks()
        mocks.create.mockResolvedValue({
            success: false,
            errorCode: 'setup_already_completed',
        })
        await submit(fillForm())
        expect(mocks.toastError).toHaveBeenCalledWith(
            'auth.firstSetup.alreadyCompleted',
            { title: 'common.error' },
        )
        expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' })
        expect(navigationChecks).toEqual([true])
    })

    it('preserves an ordinary server error and form retry', async function () {
        renderHook()
        await flushSessionActivityTasks()
        mocks.create.mockRejectedValueOnce(new Error('synthetic setup failure'))
        await submit(fillForm())
        expect(mocks.toastError).toHaveBeenCalledWith(
            'synthetic setup failure',
            { title: 'common.error' },
        )
        expect(renderHook().state.setupAccessState).toBe('granted')
        expect(renderHook().state.isCreating).toBe(false)
        expect(renderHook().state.formValues.password).toBe('abc')
        expectPrivateState()
        await submit()
        expect(mocks.navigate).toHaveBeenCalledTimes(1)
    })

    it.each([
        {
            field: 'confirmPassword',
            value: 'different',
            message: 'auth.firstSetup.passwordMismatch',
        },
        {
            field: 'email',
            value: 'invalid',
            message: 'auth.firstSetup.invalidEmail',
        },
        {
            field: 'username',
            value: '',
            message: 'auth.firstSetup.invalidUsername',
        },
        {
            field: 'firstName',
            value: 'A'.repeat(101),
            message: 'auth.firstSetup.invalidData',
        },
    ] as const)(
        'preserves the form notice for $field',
        async function ({ field, value, message }) {
            renderHook()
            await flushSessionActivityTasks()
            const hook = fillForm()
            hook.setter.setFieldValue(field, value)
            await submit()
            expect(mocks.create).not.toHaveBeenCalled()
            expect(mocks.toastError).toHaveBeenCalledWith(message, {
                title: 'common.error',
            })
        },
    )

    it('keeps the three-character minimum and the existing password-policy notice', async function () {
        renderHook()
        await flushSessionActivityTasks()
        const hook = fillForm()
        hook.setter.setFieldValue('password', 'ab')
        hook.setter.setFieldValue('confirmPassword', 'ab')
        await submit()
        expect(mocks.create).not.toHaveBeenCalled()
        expect(mocks.toastError).toHaveBeenCalledWith('auth.passwordPolicy', {
            title: 'common.error',
        })
        await submit(fillForm())
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })
})
