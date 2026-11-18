import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { pendingRegistrations } from '@/db/Schema/registration.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { verifyRegistrationService } from '@/server/Auth/Registration/verify.service.ts'

const firstToken = 'a'.repeat(43)
const secondToken = 'b'.repeat(43)
const unknownToken = 'c'.repeat(43)
const [firstHash, secondHash] = await Promise.all([
    createTokenHash(firstToken),
    createTokenHash(secondToken),
])
const invalidVerification = {
    success: false,
    error: 'registration.invalidVerification',
}
const pending = {
    username: 'person',
    email: 'person@example.test',
    passwordHash: 'hashed',
    termsVersion: '2026-11-16',
    acceptedAt: new Date(),
    provider: null,
    subject: null,
}
const attempts = new Map<string, typeof pending & { expiresAt: Date }>()
const accounts = new Set<string>()
const order: string[] = []
const dialect = new PgDialect()
let accountLock = Promise.resolve()

const createAccount = vi.fn(
    async (_transaction: unknown, input: { email: string }) => {
        order.push('create')
        if (accounts.has(input.email)) return null
        accounts.add(input.email)
        return {
            userId: 'user',
            auditReceipt: { id: 'audit', createdAt: new Date() },
        }
    },
)
const publish = vi.fn(async () => {
    order.push('publish')
})
vi.mock('@/db', () => ({
    db: {
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
            let releaseLock: (() => void) | undefined
            try {
                const result = await callback({
                    execute: async (statement: SQL) => {
                        expect(dialect.sqlToQuery(statement).sql).toBe(
                            'select pg_advisory_xact_lock(7421906)',
                        )
                        const previous = accountLock
                        const lock = Promise.withResolvers<void>()
                        accountLock = lock.promise
                        await previous
                        releaseLock = lock.resolve
                    },
                    delete: (table: unknown) => ({
                        where: (predicate: SQL) => ({
                            returning: async () => {
                                expect(releaseLock).toBeFunction()
                                expect(table).toBe(pendingRegistrations)
                                const query = dialect.sqlToQuery(predicate)
                                expect(query.sql).toBe(
                                    '"marketplace"."pending_registrations"."tokenHash" = $1',
                                )
                                const [hash] = query.params as [string]
                                const attempt = attempts.get(hash)
                                if (!attempt) return []
                                attempts.delete(hash)
                                return [attempt]
                            },
                        }),
                    }),
                })
                order.push('commit')
                return result
            } finally {
                releaseLock?.()
            }
        },
    },
}))
vi.mock('@/server/Auth/Registration/account.service.ts', () => ({
    createPublicAccountInTransactionService: createAccount,
}))
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => ({
    publishCommittedAuditLogService: publish,
}))

describe('Registration verification', () => {
    beforeEach(() => {
        const expiresAt = new Date(Date.now() + 60_000)
        attempts.clear()
        attempts.set(firstHash, { ...pending, expiresAt })
        attempts.set(secondHash, { ...pending, expiresAt })
        accounts.clear()
        accountLock = Promise.resolve()
        vi.clearAllMocks()
        order.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('consumes the pending token once and publishes after commit', async () => {
        expect(await verifyRegistrationService({ token: firstToken })).toEqual({
            success: true,
        })
        expect(order).toEqual(['create', 'commit', 'publish'])
        expect(await verifyRegistrationService({ token: firstToken })).toEqual(
            invalidVerification,
        )
        expect(createAccount).toHaveBeenCalledTimes(1)
        expect(attempts.has(secondHash)).toBe(true)
    })

    it('leaves both pending attempts intact for an unknown token', async () => {
        expect(
            await verifyRegistrationService({ token: unknownToken }),
        ).toEqual(invalidVerification)
        expect([...attempts.keys()]).toEqual([firstHash, secondHash])
        expect(createAccount).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })

    it.each([0, 1])(
        'rejects a token at or past expiry (%i ms)',
        async (elapsed) => {
            const expiry = attempts.get(firstHash)!.expiresAt.getTime()
            vi.spyOn(Date, 'now').mockReturnValue(expiry + elapsed)
            expect(
                await verifyRegistrationService({ token: firstToken }),
            ).toEqual(invalidVerification)
            expect([...attempts.keys()]).toEqual([secondHash])
            expect(createAccount).not.toHaveBeenCalled()
            expect(publish).not.toHaveBeenCalled()
        },
    )

    it('accepts one of two concurrent requests for the same token', async () => {
        const results = await Promise.all([
            verifyRegistrationService({ token: firstToken }),
            verifyRegistrationService({ token: firstToken }),
        ])
        expect(results).toContainEqual({ success: true })
        expect(results).toContainEqual(invalidVerification)
        expect(createAccount).toHaveBeenCalledTimes(1)
        expect(publish).toHaveBeenCalledTimes(1)
        expect([...attempts.keys()]).toEqual([secondHash])
    })

    it('allows only one account when separate attempts for the same identity are verified concurrently', async () => {
        const results = await Promise.all([
            verifyRegistrationService({ token: firstToken }),
            verifyRegistrationService({ token: secondToken }),
        ])
        expect(results).toContainEqual({ success: true })
        expect(results).toContainEqual(invalidVerification)
        expect(createAccount).toHaveBeenCalledTimes(2)
        expect(publish).toHaveBeenCalledTimes(1)
        expect(attempts.size).toBe(0)
    })
})
