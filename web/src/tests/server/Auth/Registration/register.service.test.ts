import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { registerService } from '@/server/Auth/Registration/register.service.ts'
import { pendingRegistrations } from '@/db/Schema/registration.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type { SocialRegistrationIdentity } from '@/lib/Auth/Types/social-auth.types.ts'

const state = {
    identity: null as SocialRegistrationIdentity | null,
    duplicate: false,
    consumed: true,
    inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    order: [] as string[],
}
const queue = vi.fn(async (_input: unknown) => {
    state.order.push('enqueue')
})
const createAccount = vi.fn(async (_tx: unknown, _input: unknown) => {
    state.order.push('create-account')
    if (state.duplicate) return null
    return {
        userId: 'new-user',
        auditReceipt: { id: 'audit', createdAt: new Date() },
    }
})
const signIn = vi.fn(
    async (
        _identity: SocialRegistrationIdentity,
    ): Promise<
        | { kind: 'success'; redirectTo: string }
        | { kind: 'error'; code: string }
    > => {
        state.order.push('sign-in')
        return { kind: 'success', redirectTo: '/user' }
    },
)
const publish = vi.fn(async () => {
    state.order.push('publish')
})
const consume = vi.fn(async (_tx: unknown, _requestId: string) => {
    state.order.push('consume')
    return state.consumed
})
const clearCookie = vi.fn(() => undefined)
const cleanup = vi.fn(async (_table: unknown, _predicate: SQL) => {
    state.order.push('cleanup')
})
vi.mock('@/db', () => ({
    db: {
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
            let selection = 0
            const tx = {
                execute: async () => {
                    state.order.push('lock')
                },
                select: () => ({
                    from: () => ({
                        where: () => ({
                            limit: async () =>
                                ++selection === 1
                                    ? [{ id: 'admin' }]
                                    : state.duplicate
                                      ? [{ id: 'existing' }]
                                      : [],
                        }),
                    }),
                }),
                delete: () => ({
                    where: async () => {
                        state.order.push('prune-expired')
                    },
                }),
                insert: (table: unknown) => ({
                    values: async (values: Record<string, unknown>) => {
                        state.inserts.push({ table, values })
                        state.order.push('pending')
                    },
                }),
            }
            const result = await callback(tx)
            state.order.push('commit')
            return result
        },
        delete: (table: unknown) => ({
            where: (predicate: SQL) => cleanup(table, predicate),
        }),
    },
}))
vi.mock('@/server/Auth/Social/registration.service.ts', () => ({
    getSocialRegistrationIdentityService: async () => state.identity,
    consumeSocialRegistrationIdentityInTransactionService: consume,
    clearSocialRegistrationCookieService: clearCookie,
}))
vi.mock('@/server/Auth/Registration/account.service.ts', () => ({
    createPublicAccountInTransactionService: createAccount,
}))
vi.mock('@/server/Auth/Social/login.service.ts', () => ({
    signInSocialIdentityService: signIn,
}))
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueueRegistrationVerificationMail: queue,
}))
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => ({
    publishCommittedAuditLogService: publish,
}))
const log = vi.fn()
vi.mock('@/server/Logging/logger.ts', () => ({ logError: log }))

const input = {
    username: 'new-person',
    email: 'person@example.test',
    password: 'secure-password-for-registration',
    acceptTerms: true as const,
}
const identity = {
    requestId: 'request-1',
    provider: 'google' as const,
    subject: 'google-subject',
    email: input.email,
    emailVerified: true,
}

describe('Registration requests', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.identity = null
        state.duplicate = false
        state.consumed = true
        state.inserts = []
        state.order = []
    })

    it('stages only pending registration with hashed password/token and a fragment confirmation link', async () => {
        expect(await registerService(input)).toEqual({
            success: true,
            requiresEmailVerification: true,
        })
        expect(state.inserts).toHaveLength(1)
        expect(state.inserts[0].table).toBe(pendingRegistrations)
        const values = state.inserts[0].values
        expect(values.passwordHash).not.toBe(input.password)
        expect(
            await Bun.password.verify(
                input.password,
                String(values.passwordHash),
            ),
        ).toBe(true)
        expect(values.termsVersion).toBe('2026-11-16')
        expect(values.acceptedAt).toBeInstanceOf(Date)
        const mail = queue.mock.calls[0][0] as { resetLink: string }
        const link = new URL(mail.resetLink)
        const token = new URLSearchParams(link.hash.slice(1)).get('verify')!
        expect(link.search).toBe('')
        expect(values.tokenHash).toBe(await createTokenHash(token))
        expect(JSON.stringify(values)).not.toContain(token)
        expect(createAccount).not.toHaveBeenCalled()
        expect(state.order.indexOf('commit')).toBeLessThan(
            state.order.indexOf('enqueue'),
        )
    })

    it('returns generic success for an already used username or email without staging or sending', async () => {
        state.duplicate = true
        expect(await registerService(input)).toEqual({
            success: true,
            requiresEmailVerification: true,
        })
        expect(state.inserts).toEqual([])
        expect(queue).not.toHaveBeenCalled()
        expect(createAccount).not.toHaveBeenCalled()
    })

    it('creates a verified social account only after consuming the server-bound handoff inside the transaction', async () => {
        state.identity = identity
        expect(
            await registerService({ ...input, password: undefined }),
        ).toEqual({
            success: true,
            requiresEmailVerification: false,
            redirectTo: '/user',
        })
        expect(consume.mock.calls[0][1]).toBe(identity.requestId)
        expect(consume.mock.calls[0][0]).toBe(createAccount.mock.calls[0][0])
        expect(createAccount.mock.calls[0][1]).toMatchObject({
            provider: 'google',
            subject: identity.subject,
            email: input.email,
        })
        expect(state.order).toEqual([
            'lock',
            'consume',
            'create-account',
            'commit',
            'publish',
            'sign-in',
        ])
        expect(signIn).toHaveBeenCalledWith(identity)
        expect(clearCookie).toHaveBeenCalledTimes(1)
        expect(queue).not.toHaveBeenCalled()
        expect(state.inserts).toEqual([])
    })

    it('returns login fallback if the account was created but automatic sign-in is unavailable', async () => {
        state.identity = identity
        signIn.mockResolvedValueOnce({ kind: 'error', code: 'failed' })
        expect(
            await registerService({ ...input, password: undefined }),
        ).toEqual({
            success: true,
            requiresEmailVerification: false,
            redirectTo: '/login',
        })
        expect(state.order).toEqual([
            'lock',
            'consume',
            'create-account',
            'commit',
            'publish',
        ])
        expect(signIn).toHaveBeenCalledTimes(1)
    })

    it('preserves successful account creation when automatic session creation throws', async () => {
        state.identity = identity
        signIn.mockRejectedValueOnce(new Error('Synthetic session failure'))
        expect(
            await registerService({ ...input, password: undefined }),
        ).toEqual({
            success: true,
            requiresEmailVerification: false,
            redirectTo: '/login',
        })
        expect(publish).toHaveBeenCalledTimes(1)
        expect(cleanup).not.toHaveBeenCalled()
    })

    it('does not sign in a duplicate social registration and preserves its generic response', async () => {
        state.identity = identity
        state.duplicate = true
        expect(
            await registerService({ ...input, password: undefined }),
        ).toEqual({ success: true, requiresEmailVerification: true })
        expect(signIn).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })

    it.each(['unverified', 'different email'])(
        'requires local confirmation for a social %s',
        async (reason) => {
            state.identity = {
                ...identity,
                ...(reason === 'unverified'
                    ? { emailVerified: false }
                    : { email: 'other@example.test' }),
            }
            expect(
                await registerService({ ...input, password: undefined }),
            ).toEqual({ success: true, requiresEmailVerification: true })
            expect(state.inserts[0].values).toMatchObject({
                provider: 'google',
                subject: identity.subject,
                email: input.email,
            })
            expect(consume).toHaveBeenCalledTimes(1)
            expect(createAccount).not.toHaveBeenCalled()
            expect(queue).toHaveBeenCalledTimes(1)
        },
    )

    it('rejects an already consumed social registration handoff', async () => {
        state.identity = identity
        state.consumed = false
        await expect(
            registerService({ ...input, password: undefined }),
        ).rejects.toThrow('expired')
        expect(createAccount).not.toHaveBeenCalled()
        expect(queue).not.toHaveBeenCalled()
        expect(state.order).not.toContain('commit')
    })

    it('removes only the unsent pending token and returns the same result as a duplicate', async () => {
        const queueError = new Error('Synthetic queue failure')
        queue.mockRejectedValueOnce(queueError)
        expect(await registerService(input)).toEqual({
            success: true,
            requiresEmailVerification: true,
        })
        expect(cleanup).toHaveBeenCalledTimes(1)
        const [table, predicate] = cleanup.mock.calls[0]!
        expect(table).toBe(pendingRegistrations)
        expect(new PgDialect().sqlToQuery(predicate)).toEqual({
            sql: '"marketplace"."pending_registrations"."tokenHash" = $1',
            params: [state.inserts[0]!.values.tokenHash],
            typings: ['none'],
        })
        expect(state.order.slice(-2)).toEqual(['commit', 'cleanup'])
        expect(createAccount).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith(
            'auth.registration.enqueue_failed',
            queueError,
        )
    })

    it('keeps the generic response if cleanup also fails', async () => {
        const cleanupError = new Error('Synthetic cleanup failure')
        queue.mockRejectedValueOnce(new Error('Synthetic queue failure'))
        cleanup.mockRejectedValueOnce(cleanupError)
        expect(await registerService(input)).toEqual({
            success: true,
            requiresEmailVerification: true,
        })
        expect(log).toHaveBeenCalledWith(
            'auth.registration.cleanup_failed',
            cleanupError,
        )
    })

    it('stages a separate verification token when the full form is submitted again', async () => {
        await registerService(input)
        await registerService(input)
        expect(state.inserts).toHaveLength(2)
        expect(state.inserts[0]!.values.tokenHash).not.toBe(
            state.inserts[1]!.values.tokenHash,
        )
        expect(queue).toHaveBeenCalledTimes(2)
        expect(cleanup).not.toHaveBeenCalled()
        expect(createAccount).not.toHaveBeenCalled()
    })

    it('requires a password without a valid server-side social identity', async () => {
        expect(
            await registerService({ ...input, password: undefined }),
        ).toEqual({ success: false, error: 'registration.passwordRequired' })
        expect(state.inserts).toEqual([])
        expect(queue).not.toHaveBeenCalled()
    })
})
