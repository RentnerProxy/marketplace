import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { SubmitEvent } from 'react'
import { defaultToastStore } from '@rentnerkev/toasts/toast'
import type { RegisterLogicReturn } from '@/features/Auth/Register/Types/register-logic.types.ts'
import type { RegistrationResult } from '@/features/Auth/Register/Types/registration.types.ts'

const reactExports = { ...React }
const cells: unknown[] = []
const refs: Array<{ current: unknown }> = []
const effects: Array<() => void> = []
let cursor = 0
let refCursor = 0
const sends: unknown[] = []
const metadata: unknown[] = []
const requests: Array<() => Promise<unknown>> = []
const register = vi.fn(async (input: unknown): Promise<RegistrationResult> => {
    sends.push(input)
    return { success: true, requiresEmailVerification: true }
})
const verify = vi.fn(async (input: unknown) => {
    sends.push(input)
    return { success: true }
})
const social: {
    data: { registration: { email: string } | null }
    isPending: boolean
    refetch: () => Promise<void>
} = { data: { registration: null }, isPending: false, refetch: async () => {} }
const refetchSocial = vi.fn(async () => {})
let hash = ''
const replaceState = vi.fn(() => {
    hash = ''
})
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
    useRef(initial: unknown) {
        return refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial })
    },
    useEffect(callback: () => void) {
        effects.push(callback)
    },
}))
vi.mock('@tanstack/react-query', () => ({
    useMutation(options: {
        mutationFn: (data: unknown) => Promise<unknown>
        meta: unknown
        onMutate?: () => void
        onSuccess?: (result: unknown) => unknown
        onError?: () => void
        onSettled?: () => void
    }) {
        metadata.push(options.meta)
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
    default: () => social,
}))
vi.mock('@/features/Auth/Register/middleware.ts', () => ({
    registerHandler: register,
    verifyRegistrationHandler: verify,
}))
vi.mock('@/features/Auth/Social/middleware.ts', () => ({
    cancelSocialAuthHandler: async () => {},
}))
import useRegisterLogic from '@/features/Auth/Register/Hooks/useRegisterLogic.ts'

function render() {
    cursor = 0
    refCursor = 0
    return useRegisterLogic()
}
const event = { preventDefault() {} } as SubmitEvent<HTMLFormElement>
function fill(logic: RegisterLogicReturn) {
    logic.setter.setUsername('alice')
    logic.setter.setEmail('alice@example.test')
    logic.setter.setPassword('long-password-123')
    logic.setter.setConfirmPassword('long-password-123')
    logic.setter.setAcceptTerms(true)
}
beforeEach(() => {
    cells.length = 0
    refs.length = 0
    effects.length = 0
    requests.length = 0
    metadata.length = 0
    sends.length = 0
    vi.clearAllMocks()
    defaultToastStore.clearAllToasts()
    social.data.registration = null
    social.isPending = false
    refetchSocial.mockImplementation(async () => {})
    social.refetch = refetchSocial
    hash = ''
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            location: {
                get hash() {
                    return hash
                },
                pathname: '/register',
                search: '',
                assign: vi.fn(),
            },
            history: { state: { preserved: true }, replaceState },
        },
    })
})
describe('registration form workflow', () => {
    it('requires consent, password policy and matching confirmation before sending', () => {
        let logic = render()
        fill(logic)
        logic.setter.setAcceptTerms(false)
        logic = render()
        logic.handler.handleSubmit(event)
        expect(requests).toHaveLength(0)
        expect(render().state.error).toBe('auth.register.termsRequired')
        expect(render().state.errorField).toBe('terms')
        logic.setter.setAcceptTerms(true)
        logic.setter.setPassword('short')
        render().handler.handleSubmit(event)
        expect(render().state.error).toBe('auth.register.passwordPolicy')
        expect(render().state.errorField).toBe('password')
        logic.setter.setPassword('long-password-123')
        logic.setter.setConfirmPassword('different-password')
        render().handler.handleSubmit(event)
        expect(render().state.error).toBe('auth.register.passwordMismatch')
        expect(render().state.errorField).toBe('confirmPassword')
        expect(requests).toHaveLength(0)
    })
    it('submits credentials with auth-secret discard metadata', async () => {
        fill(render())
        render().handler.handleSubmit(event)
        await requests[0]?.()
        expect(sends).toEqual([
            {
                data: {
                    username: 'alice',
                    email: 'alice@example.test',
                    password: 'long-password-123',
                    acceptTerms: true,
                },
            },
        ])
        expect(
            metadata.every((meta) =>
                JSON.stringify(meta).includes('discardAuthSecretsAfterSettled'),
            ),
        ).toBe(true)
    })
    it('prefills a provider email without overwriting edits and omits passwords for social registration', async () => {
        social.data.registration = { email: 'provider@example.test' }
        let logic = render()
        expect(logic.state.email).toBe('provider@example.test')
        expect(logic.state.isSocial).toBe(true)
        fill(logic)
        logic = render()
        expect(logic.state.email).toBe('alice@example.test')
        logic.handler.handleSubmit(event)
        await requests[0]?.()
        expect(sends).toEqual([
            {
                data: {
                    username: 'alice',
                    email: 'alice@example.test',
                    acceptTerms: true,
                },
            },
        ])
    })
    it('refreshes an expired provider handoff so password registration is available again', async () => {
        social.data.registration = { email: 'provider@example.test' }
        fill(render())
        expect(render().state.isSocial).toBe(true)
        register.mockResolvedValueOnce({
            success: false,
            error: 'registration.passwordRequired',
        })
        refetchSocial.mockImplementationOnce(async () => {
            social.data.registration = null
        })
        render().handler.handleSubmit(event)
        await requests[0]?.()
        expect(refetchSocial).toHaveBeenCalledTimes(1)
        expect(render().state.isSocial).toBe(false)
        expect(render().state.phase).toBe('form')
        expect(
            defaultToastStore.getToastSnapshot().map((item) => item.content),
        ).toEqual(['auth.register.passwordPolicy'])
        render().handler.handleSubmit(event)
        await requests[1]?.()
        expect(sends.at(-1)).toEqual({
            data: {
                username: 'alice',
                email: 'alice@example.test',
                password: 'long-password-123',
                acceptTerms: true,
            },
        })
    })
    it('scrubs a verification token immediately and requires one explicit confirmation request', async () => {
        hash = '#verify=' + 'A'.repeat(43)
        render()
        effects[0]?.()
        await Promise.resolve()
        expect(hash).toBe('')
        expect(replaceState).toHaveBeenCalledWith(
            { preserved: true },
            '',
            '/register',
        )
        expect(requests).toHaveLength(0)
        const logic = render()
        expect(logic.state.phase).toBe('verify')
        logic.handler.handleVerify()
        logic.handler.handleVerify()
        expect(requests).toHaveLength(1)
        await requests[0]?.()
        expect(sends).toEqual([{ data: { token: 'A'.repeat(43) } }])
        expect(JSON.stringify(metadata)).not.toContain('A'.repeat(43))
    })
    it('shows registration failures as safe deduplicated toasts', async () => {
        fill(render())
        register.mockRejectedValueOnce(
            new Error('private-registration-response'),
        )
        render().handler.handleSubmit(event)
        await requests[0]?.()
        register.mockRejectedValueOnce(
            new Error('private-registration-response'),
        )
        render().handler.handleSubmit(event)
        await requests[1]?.()
        expect(
            defaultToastStore.getToastSnapshot().map((item) => item.content),
        ).toEqual(['auth.register.failed'])
        expect(render().state.error).toBe('')
    })
    it('announces completed registration and retains inbox instructions', async () => {
        fill(render())
        render().handler.handleSubmit(event)
        await requests[0]?.()
        expect(render().state.phase).toBe('inbox')
        expect(
            defaultToastStore.getToastSnapshot().map((item) => item.content),
        ).toEqual(['auth.register.checkInbox'])
    })
    it('reports failed verification safely and confirms a successful retry', async () => {
        hash = '#verify=' + 'B'.repeat(43)
        render()
        effects[0]?.()
        await Promise.resolve()
        verify.mockResolvedValueOnce({ success: false })
        render().handler.handleVerify()
        await requests[0]?.()
        expect(
            defaultToastStore.getToastSnapshot().map((item) => item.content),
        ).toEqual(['auth.register.invalidVerification'])
        expect(render().state.phase).toBe('verify')
        render().handler.handleVerify()
        await requests[1]?.()
        expect(render().state.phase).toBe('complete')
        expect(render().state.canVerify).toBe(false)
        expect(defaultToastStore.getToastSnapshot().at(-1)?.content).toBe(
            'auth.register.complete',
        )
    })
    it('never submits a malformed verification token', async () => {
        hash = '#verify=invalid'
        render()
        effects[0]?.()
        await Promise.resolve()
        render().handler.handleVerify()
        expect(requests).toHaveLength(0)
        expect(
            defaultToastStore.getToastSnapshot().map((item) => item.content),
        ).toEqual(['auth.register.invalidVerification'])
        expect(render().state.error).toBe('')
    })
})
