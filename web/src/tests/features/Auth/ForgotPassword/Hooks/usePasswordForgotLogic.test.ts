import * as Query from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import type { SubmitEvent } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import type { RequestPasswordResetInput } from '@/features/Auth/ForgotPassword/Types/forgot-password-server-input.types.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Promise<unknown>[] = []
const request = vi.fn(async (_input: unknown) => undefined)
const success = vi.fn()
const appError = vi.fn()
let formOptions: {
    defaultValues: RequestPasswordResetInput
    onSubmit: (value: { value: RequestPasswordResetInput }) => Promise<void>
}
let formError: Error | undefined
const form = {
    handleSubmit: vi.fn(async () => {
        if (formError) throw formError
        await formOptions.onSubmit({
            value: { email: 'synthetic@example.invalid' },
        })
    }),
}
vi.mock('@tanstack/react-form', () => ({
    useForm: (options: typeof formOptions) => {
        formOptions = options
        return form
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useMutation<TData, TError, TVariables, TContext>(
        options: UseMutationOptions<TData, TError, TVariables, TContext>,
    ) {
        const observer = new queryExports.MutationObserver(client, options)
        return {
            isPending: false,
            mutate: (variables: TVariables) => {
                pending.push(observer.mutate(variables).catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/features/Auth/ForgotPassword/middleware.ts', () => ({
    requestPasswordResetHandler: request,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success } }))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: appError }))
const { default: useForgot } =
    await import('@/features/Auth/ForgotPassword/Hooks/usePasswordForgotLogic.ts')
beforeEach(() => {
    vi.clearAllMocks()
    pending.length = 0
    formError = undefined
    request.mockResolvedValue(undefined)
})
afterEach(() => {
    client.clear()
    vi.restoreAllMocks()
})
function submitEvent() {
    return {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as SubmitEvent<HTMLFormElement>
}

it('submits through the form, prevents browser submission and shows the generic success toast', async () => {
    const logic = useForgot()
    expect(formOptions.defaultValues.email).toBe('')
    expect(logic.state.isLoading).toBe(false)
    const event = submitEvent()
    logic.handler.handleSubmit(event)
    await Promise.all(pending)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
        data: { email: 'synthetic@example.invalid' },
    })
    expect(success).toHaveBeenCalledWith('auth.forgotPassword.emailSent', {
        title: 'auth.forgotPassword.title',
    })
    expect(appError).not.toHaveBeenCalled()
})

it('forwards a request failure to the application error presenter', async () => {
    const failure = new Error('Synthetic reset rejection')
    request.mockRejectedValueOnce(failure)
    useForgot().handler.handleSubmit(submitEvent())
    await Promise.all(pending)
    expect(appError).toHaveBeenCalledWith(failure)
    expect(success).not.toHaveBeenCalled()
})

it('handles a rejected form submission without calling the reset service', async () => {
    formError = new Error('Synthetic form validation rejection')
    useForgot().handler.handleSubmit(submitEvent())
    await Promise.resolve()
    expect(appError).toHaveBeenCalledWith(formError)
    expect(appError).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
})
