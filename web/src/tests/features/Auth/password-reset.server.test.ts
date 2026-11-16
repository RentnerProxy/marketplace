import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { passwordResetConfig } from '@/config/session.config.ts'

const events: Array<string> = []
const mocks = {
    validate: vi.fn(async (_token: string) => {
        events.push('validate')
        return { valid: true, length: 1 }
    }),
    update: vi.fn(async (_data: { token: string; password: string }) => {
        events.push('update')
        return { success: true }
    }),
    quota: vi.fn(
        async (options: {
            scope: string
            identifiers?: ReadonlyArray<string>
        }) => {
            events.push(options.scope)
        },
    ),
}

vi.mock('@tanstack/react-start', () => ({
    createServerFn: (options: { method: string }) => ({
        validator: <TData>(validate: (data: unknown) => TData) => ({
            handler: <TResult>(
                handler: (options: { data: TData }) => Promise<TResult>,
            ) =>
                Object.assign(
                    async (input: { data: unknown }) =>
                        handler({ data: validate(input.data) }),
                    { method: options.method },
                ),
        }),
    }),
}))
vi.mock('@/server/Auth/PasswordReset/get.service.ts', () => ({
    validatePasswordResetTokenService: mocks.validate,
}))
vi.mock('@/server/Auth/PasswordReset/update.service.ts', () => ({
    updatePasswordByTokenService: mocks.update,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: mocks.quota,
}))

const { validateTokenHandler, updatePasswordByTokenHandler } =
    await import('@/features/Auth/PasswordReset/middleware.ts')

describe('password reset server adapters', () => {
    beforeEach(() => {
        events.length = 0
        vi.clearAllMocks()
    })

    it('validates through POST after its existing IP quota', async () => {
        expect(Reflect.get(validateTokenHandler, 'method')).toBe('POST')
        expect(
            await validateTokenHandler({
                data: { token: '  synthetic-token  ' },
            }),
        ).toEqual({
            valid: true,
            length: 1,
        })
        expect(events).toEqual(['password-reset-validate-ip', 'validate'])
        expect(mocks.quota.mock.calls).toEqual([
            [
                {
                    ...RATE_LIMITS.passwordResetValidateIp,
                    scope: 'password-reset-validate-ip',
                },
            ],
        ])
        expect(mocks.validate.mock.calls).toEqual([['synthetic-token']])
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it.each([
        '',
        '   ',
        'x'.repeat(passwordResetConfig.maximumTokenLength + 1),
    ])(
        'rejects malformed validation input before any service call',
        async (token) => {
            await expect(
                validateTokenHandler({ data: { token } }),
            ).rejects.toThrow()
            expect(events).toEqual([])
        },
    )

    it('keeps arbitrary bounded tokens compatible and strips untrusted extra fields', async () => {
        await Reflect.apply(validateTokenHandler, undefined, [
            {
                data: {
                    token: 'abc+/= not-a-uuid',
                    userId: 'chosen-account',
                    valid: true,
                },
            },
        ])
        expect(mocks.validate.mock.calls).toEqual([['abc+/= not-a-uuid']])
    })

    it.each([null, undefined, 123, [], { token: 123 }, { password: 'abc' }])(
        'validates unknown structured input',
        async (data) => {
            await expect(
                Reflect.apply(validateTokenHandler, undefined, [{ data }]),
            ).rejects.toThrow()
            expect(events).toEqual([])
        },
    )

    it('stops before token lookup on an exhausted IP quota', async () => {
        const denied = new Error('Synthetic rate limit')
        mocks.quota.mockRejectedValueOnce(denied)
        await expect(
            validateTokenHandler({ data: { token: 'token' } }),
        ).rejects.toBe(denied)
        expect(mocks.validate).not.toHaveBeenCalled()
    })

    it('keeps password mutation on POST with both quotas and the chosen four-character minimum', async () => {
        expect(Reflect.get(updatePasswordByTokenHandler, 'method')).toBe('POST')
        await updatePasswordByTokenHandler({
            data: { token: ' token ', password: 'abcd' },
        })
        expect(events).toEqual([
            'password-reset-finish-ip',
            'password-reset-finish',
            'update',
        ])
        expect(mocks.quota.mock.calls).toEqual([
            [
                {
                    ...RATE_LIMITS.passwordResetFinishIp,
                    scope: 'password-reset-finish-ip',
                },
            ],
            [
                {
                    ...RATE_LIMITS.passwordResetFinish,
                    scope: 'password-reset-finish',
                    identifiers: ['token'],
                },
            ],
        ])
        expect(mocks.update.mock.calls).toEqual([
            [{ token: 'token', password: 'abcd' }],
        ])
    })

    it.each(['a', 'ab', 'abc', 'x'.repeat(1025)])(
        'keeps the password limits at the server boundary',
        async (password) => {
            await expect(
                updatePasswordByTokenHandler({
                    data: { token: 'token', password },
                }),
            ).rejects.toThrow()
            expect(events).toEqual([])
        },
    )

    it('does not mutate after the token quota rejects', async () => {
        const denied = new Error('Synthetic token quota')
        mocks.quota
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(denied)
        await expect(
            updatePasswordByTokenHandler({
                data: { token: 'token', password: 'abcd' },
            }),
        ).rejects.toBe(denied)
        expect(mocks.update).not.toHaveBeenCalled()
    })
})
