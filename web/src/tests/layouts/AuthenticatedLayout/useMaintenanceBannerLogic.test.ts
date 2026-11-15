import * as Query from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'bun:test'
import { hookReact, renderHook, resetHooks } from '../hook-harness.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const request = vi.fn(
    async (_input: {
        data: { reason: string }
    }): Promise<{ success: boolean; error?: string }> => ({ success: true }),
)
const success = vi.fn()
const errorToast = vi.fn()
const pending: Promise<unknown>[] = []
vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => client,
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
vi.mock('@/features/Maintenance/middleware.ts', () => ({
    requestMaintenanceExtensionHandler: request,
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    SYSTEM_SETTINGS_QUERY_KEY: ['settings'],
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success } }))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: errorToast,
}))
const { default: useBanner } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useMaintenanceBannerLogic.ts')
const render = () => renderHook(useBanner)
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    pending.length = 0
    request.mockResolvedValue({ success: true })
    client.clear()
})

it('rejects short reasons before sending a request', () => {
    render().handler.handleReasonChange('  short  ')
    render().handler.handleRequestMaintenanceExtension()
    expect(request).not.toHaveBeenCalled()
    expect(errorToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'toast.maintenanceInvalidReason' }),
    )
})

it('trims a valid reason, clears the input and invalidates settings on success', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render().handler.handleReasonChange('  Finishing a critical task  ')
    render().handler.handleRequestMaintenanceExtension()
    await Promise.all(pending)
    expect(request).toHaveBeenCalledWith({
        data: { reason: 'Finishing a critical task' },
    })
    expect(render().state.reason).toBe('')
    expect(success).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] })
    invalidate.mockRestore()
})

it.each(['rejected', 'exception', 'unknown'] as const)(
    'preserves the entered reason and reports %s errors',
    async (mode) => {
        if (mode === 'rejected')
            request.mockResolvedValueOnce({
                success: false,
                error: 'Request already pending',
            })
        else
            request.mockRejectedValueOnce(
                mode === 'exception' ? new Error('Connection lost') : null,
            )
        render().handler.handleReasonChange('Finishing a critical task')
        render().handler.handleRequestMaintenanceExtension()
        await Promise.all(pending)
        expect(success).not.toHaveBeenCalled()
        expect(render().state.reason).toBe('Finishing a critical task')
        expect(errorToast).toHaveBeenCalledWith(
            expect.objectContaining({
                message:
                    mode === 'rejected'
                        ? 'Request already pending'
                        : mode === 'exception'
                          ? 'Connection lost'
                          : 'toast.maintenanceRequestFailed',
            }),
        )
    },
)
