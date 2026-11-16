import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { verifyRegistrationService } from '@/server/Auth/Registration/verify.service.ts'

const pending = {
    username: 'person',
    email: 'person@example.test',
    passwordHash: 'hashed',
    expiresAt: new Date(Date.now() + 60_000),
    termsVersion: '2026-11-16',
    acceptedAt: new Date(),
    provider: null,
    subject: null,
}
const state = {
    pending: [pending],
    created: {
        userId: 'user',
        auditReceipt: { id: 'audit', createdAt: new Date() },
    } as {
        userId: string
        auditReceipt: { id: string; createdAt: Date }
    } | null,
}
const order: string[] = []
const createAccount = vi.fn(async () => {
    order.push('create')
    return state.created
})
const publish = vi.fn(async () => {
    order.push('publish')
})
vi.mock('@/db', () => ({
    db: {
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
            const result = await callback({
                execute: async () => undefined,
                delete: () => ({
                    where: () => ({
                        returning: async () => state.pending.splice(0),
                    }),
                }),
            })
            order.push('commit')
            return result
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
        state.pending = [
            { ...pending, expiresAt: new Date(Date.now() + 60_000) },
        ]
        vi.clearAllMocks()
        order.length = 0
    })
    it('consumes the pending token once and publishes after commit', async () => {
        expect(
            await verifyRegistrationService({ token: 'a'.repeat(43) }),
        ).toEqual({ success: true })
        expect(order).toEqual(['create', 'commit', 'publish'])
        expect(
            (await verifyRegistrationService({ token: 'a'.repeat(43) }))
                .success,
        ).toBe(false)
        expect(createAccount).toHaveBeenCalledTimes(1)
    })
    it('does not create an account for expired confirmation', async () => {
        state.pending[0]!.expiresAt = new Date(0)
        expect(
            (await verifyRegistrationService({ token: 'a'.repeat(43) }))
                .success,
        ).toBe(false)
        expect(createAccount).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })
})
