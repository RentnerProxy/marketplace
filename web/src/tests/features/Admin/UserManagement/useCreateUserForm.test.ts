import { beforeEach, expect, it, vi } from 'bun:test'

const submit = vi.fn(async () => {})
const reportError = vi.fn()
vi.mock('@tanstack/react-form', () => ({
    useForm: () => ({ handleSubmit: submit }),
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({}),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    createUserHandler: vi.fn(),
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: reportError,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

const { default: useCreateUserForm } =
    await import('@/features/Admin/UserManagement/Hooks/useCreateUserForm.ts')

beforeEach(() => {
    submit.mockReset().mockResolvedValue(undefined)
    reportError.mockReset()
})

it('prevents browser submission and reports unexpected form failures', async () => {
    const error = new Error('Form validation unavailable')
    submit.mockRejectedValueOnce(error)
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    const { handler } = useCreateUserForm({ onCreateResponse: vi.fn() })
    handler.handleSubmit(event)
    await Promise.resolve()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(error)
})
