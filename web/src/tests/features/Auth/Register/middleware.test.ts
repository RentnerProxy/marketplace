import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RATE_LIMITS, REGISTRATION_POLICY } from '@/config/security.config.ts'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const verificationRequired = {
    success: true,
    requiresEmailVerification: true,
} as const
const invalidVerification = {
    success: false,
    error: 'registration.invalidVerification',
}
const enforceRateLimit = vi.fn(async (_options: unknown) => undefined)
const wait = vi.fn(async (): Promise<void> => {})
const createEnumerationProtection = vi.fn(() => ({ wait }))
const register = vi.fn(async (_input: unknown) => verificationRequired)
const verify = vi.fn(async (_input: unknown) => ({ success: true }))
const log = vi.fn()

vi.mock('@tanstack/react-start', () => ({
    createServerFn: (options: { method: string }) => {
        expect(options.method).toBe('POST')
        return {
            validator: (validate: (data: unknown) => unknown) => ({
                handler:
                    (handle: (context: { data: unknown }) => unknown) =>
                    ({ data }: { data: unknown }) =>
                        handle({ data: validate(data) }),
            }),
        }
    },
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({ enforceRateLimit }))
vi.mock('@/server/Auth/enumerationProtection.service.ts', () => ({
    createEnumerationProtection,
}))
vi.mock('@/server/Auth/Registration/register.service.ts', () => ({
    registerService: register,
}))
vi.mock('@/server/Auth/Registration/verify.service.ts', () => ({
    verifyRegistrationService: verify,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError: log }))

const { registerHandler, verifyRegistrationHandler } =
    await import('@/features/Auth/Register/middleware.ts')

const input = {
    username: 'person',
    email: ' Person@Example.test ',
    password: 'synthetic-password',
    acceptTerms: true as const,
}
const token = 'a'.repeat(43)
const ipLimit = {
    ...RATE_LIMITS.registrationIp,
    scope: 'registration-ip',
}
const accountLimit = {
    ...RATE_LIMITS.registrationAccount,
    scope: 'registration-account',
    identifiers: ['person@example.test'],
    includeClientIp: false,
}
const verificationLimit = {
    ...RATE_LIMITS.registrationVerifyIp,
    scope: 'registration-verify-ip',
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('Registration request boundary', () => {
    it('checks both budgets before registering and floors its generic response', async () => {
        const delay = Promise.withResolvers<void>()
        wait.mockReturnValueOnce(delay.promise)
        let responded = false
        const result = registerHandler({ data: input }).then((response) => {
            responded = true
            return response
        })

        try {
            await waitForAssertion(() => expect(wait).toHaveBeenCalledTimes(1))
            expect(createEnumerationProtection).toHaveBeenCalledWith(
                REGISTRATION_POLICY.minimumResponseMs,
            )
            expect(enforceRateLimit.mock.calls).toEqual([
                [ipLimit],
                [accountLimit],
            ])
            expect(enforceRateLimit.mock.invocationCallOrder[1]!).toBeLessThan(
                register.mock.invocationCallOrder[0]!,
            )
            expect(register).toHaveBeenCalledWith({
                ...input,
                email: 'person@example.test',
            })
            expect(responded).toBe(false)
        } finally {
            delay.resolve()
        }
        expect(await result).toEqual(verificationRequired)
    })

    it.each(['ip', 'account'])(
        'denies exhausted %s quota before calling registration',
        async (limited) => {
            const error = new Error('Synthetic exhausted rate limit')
            if (limited === 'account')
                enforceRateLimit.mockResolvedValueOnce(undefined)
            enforceRateLimit.mockRejectedValueOnce(error)
            expect(await registerHandler({ data: input })).toEqual({
                success: false,
                error: 'registration.failed',
            })
            expect(enforceRateLimit.mock.calls).toEqual(
                limited === 'ip' ? [[ipLimit]] : [[ipLimit], [accountLimit]],
            )
            expect(register).not.toHaveBeenCalled()
            expect(wait).toHaveBeenCalledTimes(1)
            expect(log).toHaveBeenCalledWith('auth.registration.failed', error)
        },
    )
})

describe('Verification request boundary', () => {
    it('uses the verification IP budget before reading the token', async () => {
        expect(await verifyRegistrationHandler({ data: { token } })).toEqual({
            success: true,
        })
        expect(enforceRateLimit.mock.calls).toEqual([[verificationLimit]])
        expect(enforceRateLimit.mock.invocationCallOrder[0]!).toBeLessThan(
            verify.mock.invocationCallOrder[0]!,
        )
        expect(verify).toHaveBeenCalledWith({ token })
    })

    it('returns the generic verification error without consulting the token after a quota denial', async () => {
        const error = new Error('Synthetic exhausted rate limit')
        enforceRateLimit.mockRejectedValueOnce(error)
        expect(await verifyRegistrationHandler({ data: { token } })).toEqual(
            invalidVerification,
        )
        expect(enforceRateLimit.mock.calls).toEqual([[verificationLimit]])
        expect(verify).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith(
            'auth.registration.verification_failed',
            error,
        )
    })
})
