import { beforeEach, expect, it, vi } from 'bun:test'

const steps: string[] = []
const methods: string[] = []
const status = vi.fn(async () => ({ isRequired: true }))
const created = {
    success: true as const,
    user: {
        id: 'synthetic-user-id',
        username: 'synthetic-user',
        email: 'synthetic@example.invalid',
    },
}
const create = vi.fn(async (_input: unknown) => {
    steps.push('create')
    return created
})
const rateLimit = vi.fn(async (input: { scope: string }) => {
    steps.push(input.scope)
})
vi.mock('@tanstack/react-start', () => ({
    createServerFn: ({ method }: { method: string }) => {
        methods.push(method)
        return {
            handler<T>(operation: () => T) {
                return () => operation()
            },
            validator<T>(validate: (data: unknown) => T) {
                return {
                    handler<TResult>(
                        operation: (context: { data: T }) => TResult,
                    ) {
                        return (input: { data: unknown }) =>
                            operation({ data: validate(input.data) })
                    },
                }
            },
        }
    },
}))
vi.mock('@/server/SystemBootstrap/first-super-user.service.ts', () => ({
    createFirstSuperUserAccountService: create,
    getFirstSuperUserSetupStatusService: status,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))
const {
    createFirstSuperUserAccountHandler,
    getFirstSuperUserSetupStatusHandler,
} = await import('@/features/Auth/FirstSuperUser/middleware.ts')
const input = {
    username: '  synthetic-user  ',
    email: '  synthetic@example.invalid  ',
    password: 'synthetic-password',
    confirmPassword: 'synthetic-password',
    firstName: '',
    lastName: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
    setupToken: '  synthetic-setup-token  ',
}
beforeEach(() => {
    vi.clearAllMocks()
    steps.length = 0
    rateLimit.mockImplementation(async (options) => {
        steps.push(options.scope)
    })
})

it('uses GET for setup status and delegates to the mocked bootstrap service', async () => {
    expect(methods).toEqual(['GET', 'POST'])
    expect(await getFirstSuperUserSetupStatusHandler()).toEqual({
        isRequired: true,
    })
    expect(status).toHaveBeenCalledTimes(1)
    expect(rateLimit).not.toHaveBeenCalled()
})

it('validates and normalizes input and enforces both limits before account creation', async () => {
    expect(await createFirstSuperUserAccountHandler({ data: input })).toEqual(
        created,
    )
    expect(steps).toEqual(['first-user-setup-ip', 'first-user-setup', 'create'])
    expect(rateLimit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
            scope: 'first-user-setup',
            identifiers: ['synthetic-user', 'synthetic@example.invalid'],
        }),
    )
    expect(create).toHaveBeenCalledWith({
        ...input,
        username: 'synthetic-user',
        email: 'synthetic@example.invalid',
        setupToken: 'synthetic-setup-token',
    })
})

it.each([
    { ...input, email: 'invalid' },
    { ...input, confirmPassword: 'different-password' },
    { ...input, username: '' },
])(
    'rejects invalid input before rate limiting or service calls',
    async (data) => {
        await expect(
            Promise.resolve().then(() =>
                createFirstSuperUserAccountHandler({ data }),
            ),
        ).rejects.toThrow()
        expect(create).not.toHaveBeenCalled()
        expect(rateLimit).not.toHaveBeenCalled()
    },
)

it.each([1, 2])(
    'stops before creation when rate limit %s rejects',
    async (rejectAt) => {
        const failure = new Error('Synthetic rate limit rejection')
        if (rejectAt === 2) rateLimit.mockResolvedValueOnce(undefined)
        rateLimit.mockRejectedValueOnce(failure)
        await expect(
            createFirstSuperUserAccountHandler({ data: input }),
        ).rejects.toBe(failure)
        expect(rateLimit).toHaveBeenCalledTimes(rejectAt)
        expect(create).not.toHaveBeenCalled()
    },
)
