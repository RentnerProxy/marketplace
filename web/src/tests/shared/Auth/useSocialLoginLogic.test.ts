import * as React from 'react'
import { beforeEach, expect, it, vi } from 'bun:test'
import type { SubmitEvent } from 'react'
import { defaultToastStore } from '@rentnerkev/toasts/toast'
const reactExports = { ...React }
const cells: unknown[] = []
let cursor = 0
let refCursor = 0
const refs: Array<{ current: unknown }> = []
const effects: Array<() => void> = []
const requests: Array<() => Promise<unknown>> = []
const begin = vi.fn(async (_data: unknown) => ({
    url: 'https://provider.example.test/authorize',
}))
const finish = vi.fn(async (_data: unknown) => ({
    success: true,
    redirectTo: '/',
}))
let hash = ''
const replace = vi.fn(() => {
    hash = ''
})
const query = {
    data: {
        providers: [{ id: 'google', name: 'Google' }],
        requiresTwoFactor: false,
    },
    isError: false,
    errorUpdatedAt: 0,
    refetch: vi.fn(async () => ({ isError: false })),
}
vi.mock('react', () => ({
    ...reactExports,
    useState(initial: unknown) {
        const index = cursor++
        if (!(index in cells)) cells[index] = initial
        return [
            cells[index],
            (value: unknown) => {
                cells[index] = value
            },
        ]
    },
    useEffect(callback: () => void) {
        effects.push(callback)
    },
    useRef(initial: unknown) {
        return refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial })
    },
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ clear: vi.fn() }),
    useMutation(options: {
        mutationFn: (data: unknown) => Promise<unknown>
        onMutate?: () => void
        onSuccess?: (result: unknown) => unknown
        onError?: () => void
        onSettled?: () => void
    }) {
        return {
            isPending: false,
            reset() {},
            mutate(data: unknown) {
                requests.push(async () => {
                    options.onMutate?.()
                    try {
                        await options.onSuccess?.(
                            await options.mutationFn(data),
                        )
                    } catch {
                        options.onError?.()
                    } finally {
                        options.onSettled?.()
                    }
                })
            },
        }
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/shared/Auth/Hooks/useSocialAuthState.ts', () => ({
    default: () => query,
}))
vi.mock('@/features/Auth/Social/middleware.ts', () => ({
    beginSocialLoginHandler: begin,
    finishSocialLoginHandler: finish,
    cancelSocialAuthHandler: async () => {},
}))
import useSocialLoginLogic from '@/shared/Auth/Hooks/useSocialLoginLogic.ts'
function render() {
    cursor = 0
    refCursor = 0
    effects.length = 0
    return useSocialLoginLogic()
}
function runEffects() {
    effects.forEach((effect) => effect())
}
beforeEach(() => {
    cells.length = 0
    refs.length = 0
    effects.length = 0
    requests.length = 0
    hash = ''
    vi.clearAllMocks()
    defaultToastStore.clearAllToasts()
    query.isError = false
    query.errorUpdatedAt = 0
    query.data.requiresTwoFactor = false
    query.refetch.mockResolvedValue({ isError: false })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            location: {
                get hash() {
                    return hash
                },
                pathname: '/login',
                search: '',
                assign: vi.fn(),
            },
            history: { state: {}, replaceState: replace },
        },
    })
})
it('shows configured providers and begins only after a user action', async () => {
    const logic = render()
    expect(logic.state.providers).toEqual([{ id: 'google', name: 'Google' }])
    expect(begin).not.toHaveBeenCalled()
    logic.handler.handleBegin('google')
    await requests[0]?.()
    expect(begin).toHaveBeenCalledWith({ data: { provider: 'google' } })
})
it('rejects incomplete 2FA codes and sends a complete code independently of password login', async () => {
    query.data.requiresTwoFactor = true
    let logic = render()
    expect(logic.state.requiresTwoFactor).toBe(true)
    logic.setter.setCode('12')
    render().handler.handleSubmit({
        preventDefault() {},
    } as SubmitEvent<HTMLFormElement>)
    expect(requests).toHaveLength(0)
    expect(render().state.error).toBe('auth.login.twoFactorCodeIncomplete')
    logic.setter.setCode('123456')
    logic = render()
    logic.handler.handleSubmit({
        preventDefault() {},
    } as SubmitEvent<HTMLFormElement>)
    await requests[0]?.()
    expect(finish).toHaveBeenCalledWith({ data: { twoFactorCode: '123456' } })
})
it('scrubs callback error fragments and gives the existing-account linking guidance', async () => {
    hash = '#social-error=account_exists'
    render()
    effects[0]?.()
    await Promise.resolve()
    expect(hash).toBe('')
    expect(replace).toHaveBeenCalledWith({}, '', '/login')
    render()
    runEffects()
    expect(
        defaultToastStore.getToastSnapshot().map((item) => item.content),
    ).toEqual(['auth.social.account_exists'])
    expect(render().state.error).toBe('')
})
it('maps untrusted callback reasons to a generic translated error', async () => {
    hash = '#social-error=untrusted-message'
    render()
    effects[0]?.()
    await Promise.resolve()
    expect(
        defaultToastStore.getToastSnapshot().map((item) => item.content),
    ).toEqual(['auth.social.failed'])
    expect(render().state.error).toBe('')
})
it('deduplicates unavailable provider queries and offers retry through the toast', async () => {
    query.isError = true
    query.errorUpdatedAt = 1
    render()
    runEffects()
    render()
    runEffects()
    query.errorUpdatedAt = 2
    render()
    runEffects()
    const snapshot = defaultToastStore.getToastSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]?.content).toBe('auth.social.unavailable')
    query.refetch.mockResolvedValueOnce({ isError: true })
    await snapshot[0]?.action?.onClick(snapshot[0].id)
    expect(defaultToastStore.getToastSnapshot()).toHaveLength(1)
    await snapshot[0]?.action?.onClick(snapshot[0].id)
    expect(query.refetch).toHaveBeenCalledTimes(2)
    expect(defaultToastStore.getToastSnapshot()).toHaveLength(0)
})
it('deduplicates failed provider actions without exposing their rejected payload', async () => {
    begin.mockRejectedValueOnce(new Error('private-provider-response'))
    render().handler.handleBegin('google')
    await requests[0]?.()
    begin.mockRejectedValueOnce(new Error('private-provider-response'))
    render().handler.handleBegin('google')
    await requests[1]?.()
    expect(
        defaultToastStore.getToastSnapshot().map((item) => item.content),
    ).toEqual(['auth.social.failed'])
    expect(render().state.error).toBe('')
})
it('reports a rejected second-factor action with the same safe toast', async () => {
    finish.mockResolvedValueOnce({ success: false, redirectTo: '/' })
    render().setter.setCode('123456')
    render().handler.handleSubmit({
        preventDefault() {},
    } as SubmitEvent<HTMLFormElement>)
    await requests[0]?.()
    expect(
        defaultToastStore.getToastSnapshot().map((item) => item.content),
    ).toEqual(['auth.social.failed'])
    expect(render().state.error).toBe('')
})
