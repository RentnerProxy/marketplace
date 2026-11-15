import * as actualReact from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, dehydrate } from '@tanstack/react-query'
import { passwordResetConfig } from '@/config/session.config.ts'
import {
    captureResetToken,
    getPasswordResetTokenHandoff,
} from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'
import { createResetTestBrowser } from './password-reset.test.helpers.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { PasswordResetFormValues } from '@/features/Auth/PasswordReset/Types/password-reset-form.types.ts'
import type {
    ResetHookEffect,
    ResetHookFormOptions,
    ResetHookServerCall,
} from './password-reset-hooks.test.types.ts'

const actualReactExports = { ...actualReact }
const cells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const effects: Array<ResetHookEffect> = []
let stateCursor = 0
let refCursor = 0
let effectCursor = 0
let formOptions: ResetHookFormOptions | undefined
let testBrowser = createResetTestBrowser(
    '/password-reset#token=synthetic-reset-proof',
)
const emptyValues = (): PasswordResetFormValues => ({
    password: '',
    confirmPassword: '',
})
const form = {
    values: emptyValues(),
    reset: vi.fn(function () {
        form.values = emptyValues()
    }),
    async handleSubmit() {
        await formOptions?.onSubmit({ value: form.values })
    },
}
const mocks = {
    navigate: vi.fn(async function () {}),
    toast: vi.fn(),
    t: (key: string) => key,
    validate: vi.fn(async function (
        _options: ResetHookServerCall,
    ): Promise<unknown> {
        return { valid: true }
    }),
    update: vi.fn(async function (
        _options: ResetHookServerCall,
    ): Promise<unknown> {
        return { success: true }
    }),
}
vi.mock('react', () => ({
    ...actualReactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in cells)) cells[index] = initial
        return [
            cells[index],
            (value: unknown) => {
                cells[index] = value
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
vi.mock('@tanstack/react-form', () => ({
    useForm(options: ResetHookFormOptions) {
        formOptions = options
        return form
    },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@rentnerkev/toasts', () => ({
    toast: {
        error: mocks.toast,
        info: mocks.toast,
        success: mocks.toast,
        warning: mocks.toast,
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: mocks.t }),
}))
vi.mock('@/features/Auth/PasswordReset/middleware.ts', () => ({
    validateTokenHandler: mocks.validate,
    updatePasswordByTokenHandler: mocks.update,
}))

import usePasswordResetLogic from '@/features/Auth/PasswordReset/Hooks/usePasswordResetLogic.ts'

function renderHook(commit = true) {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    const result = usePasswordResetLogic()
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
beforeEach(function () {
    vi.clearAllMocks()
    cells.length = 0
    refs.length = 0
    effects.length = 0
    form.values = emptyValues()
    formOptions = undefined
    testBrowser = createResetTestBrowser(
        '/password-reset#token=synthetic-reset-proof',
    )
    captureResetToken(testBrowser.browser)
    stubTestGlobal('window', testBrowser.browser)
    mocks.validate.mockResolvedValue({ valid: true })
    mocks.update.mockResolvedValue({ success: true })
    mocks.navigate.mockResolvedValue(undefined)
})
afterEach(async function () {
    unmount()
    await flushSessionActivityTasks()
    restoreTestGlobals()
})

describe('Password reset hook client boundary', function () {
    it('preserves the token through abandoned lazy rendering and the StrictMode setup/cleanup replay', async function () {
        expect(renderHook(false).state.phase).toBe('checking')
        expect(mocks.validate).not.toHaveBeenCalled()
        cells.length = 0
        refs.length = 0
        effects.length = 0
        renderHook()
        for (const effect of effects) {
            effect.cleanup?.()
            const cleanup = effect.setup()
            effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        }
        await flushSessionActivityTasks()
        expect(mocks.validate).toHaveBeenCalledTimes(1)
        expect(mocks.validate).toHaveBeenCalledWith({
            data: { token: 'synthetic-reset-proof' },
            signal: expect.any(AbortSignal),
        })
        expect(renderHook().state.phase).toBe('ready')
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(
            getPasswordResetTokenHandoff(testBrowser.browser)?.take(),
        ).toEqual({ status: 'missing' })
    })
    it.each([
        { hash: '', notice: 'password-reset-token-missing' },
        { hash: '#token=%', notice: 'password-reset-token-invalid' },
    ])('preserves the $notice login notice', async function ({ hash, notice }) {
        testBrowser = createResetTestBrowser('/password-reset' + hash)
        captureResetToken(testBrowser.browser)
        stubTestGlobal('window', testBrowser.browser)
        renderHook()
        await flushSessionActivityTasks()
        expect(mocks.validate).not.toHaveBeenCalled()
        expect(mocks.navigate).toHaveBeenCalledWith({
            to: '/login',
            hash: notice,
            replace: true,
        })
        expect(form.values).toEqual(emptyValues())
    })
    it('submits with local state only, clears drafts before the request, and redirects after success', async function () {
        const queryClient = new QueryClient()
        const sent: Array<unknown> = []
        const pending = Promise.withResolvers<unknown>()
        mocks.update.mockImplementation(function (options) {
            sent.push({ ...options.data })
            return pending.promise
        })
        renderHook()
        await flushSessionActivityTasks()
        form.values = { password: 'aaa', confirmPassword: 'aaa' }
        const result = form.handleSubmit()
        expect(form.values).toEqual(emptyValues())
        expect(renderHook().state.phase).toBe('submitting')
        expect(sent).toEqual([
            { token: 'synthetic-reset-proof', password: 'aaa' },
        ])
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        expect(JSON.stringify(dehydrate(queryClient))).not.toContain(
            'synthetic-reset-proof',
        )
        pending.resolve({ success: true })
        await result
        expect(renderHook().state.phase).toBe('complete')
        expect(mocks.navigate).toHaveBeenCalledWith({
            to: '/login',
            replace: true,
        })
        expect(mocks.toast).toHaveBeenCalledWith('auth.passwordReset.updated', {
            title: 'auth.passwordReset.updatedTitle',
        })
        expect(form.values).toEqual(emptyValues())
        queryClient.clear()
    })
    it('invalidates an old validation synchronously when a second link arrives', async function () {
        const oldRead = Promise.withResolvers<unknown>()
        mocks.validate.mockImplementationOnce(() => oldRead.promise)
        renderHook()
        await flushSessionActivityTasks()
        const oldSignal = mocks.validate.mock.calls[0]?.[0].signal
        testBrowser.browser.location.hash = '#token=synthetic-second'
        testBrowser.browser.dispatchEvent(new Event('popstate'))
        expect(oldSignal?.aborted).toBe(true)
        oldRead.resolve({ valid: false })
        await flushSessionActivityTasks()
        expect(mocks.validate).toHaveBeenCalledTimes(2)
        expect(mocks.validate.mock.calls[1]?.[0].data.token).toBe(
            'synthetic-second',
        )
        expect(renderHook().state.phase).toBe('ready')
        expect(mocks.navigate).not.toHaveBeenCalled()
    })
    it('keeps a newer link when an old submission finishes after the token changed', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.update.mockImplementation(() => pending.promise)
        renderHook()
        await flushSessionActivityTasks()
        form.values = { password: 'aaa', confirmPassword: 'aaa' }
        const result = form.handleSubmit()
        testBrowser.browser.location.hash = '#token=synthetic-second'
        testBrowser.browser.dispatchEvent(new Event('hashchange'))
        await flushSessionActivityTasks()
        await result
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(renderHook().state.phase).toBe('ready')
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
        expect(form.values).toEqual(emptyValues())
    })
    it('clears an unclaimed handoff when unmounted before its first client microtask', async function () {
        renderHook()
        unmount()
        await flushSessionActivityTasks()
        expect(mocks.validate).not.toHaveBeenCalled()
        expect(
            getPasswordResetTokenHandoff(testBrowser.browser)?.take(),
        ).toEqual({ status: 'missing' })
        expect(form.values).toEqual(emptyValues())
    })
    it('aborts and clears a pending operation on unmount without processing its late result', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.validate.mockImplementation(() => pending.promise)
        renderHook()
        await flushSessionActivityTasks()
        const signal = mocks.validate.mock.calls[0]?.[0].signal
        unmount()
        pending.resolve({ valid: false })
        await flushSessionActivityTasks()
        expect(signal?.aborted).toBe(true)
        expect(form.values).toEqual(emptyValues())
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(testBrowser.clock.pending.size).toBe(0)
    })
    it('exposes a bounded manual retry after a validation timeout', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.validate.mockImplementationOnce(() => pending.promise)
        renderHook()
        await flushSessionActivityTasks()
        await testBrowser.clock.advance(passwordResetConfig.requestTimeoutMs)
        expect(renderHook().state.phase).toBe('unavailable')
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(testBrowser.clock.pending.size).toBe(0)
        renderHook().handler.handleRetryValidation()
        await flushSessionActivityTasks()
        expect(renderHook().state.phase).toBe('ready')
        expect(mocks.validate).toHaveBeenCalledTimes(2)
        pending.resolve({ valid: false })
        await flushSessionActivityTasks()
        expect(mocks.navigate).not.toHaveBeenCalled()
    })
})
