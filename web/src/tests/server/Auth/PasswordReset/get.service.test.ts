import { beforeEach, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../../Admin/AuditLogs/read-query.test.helpers.ts'

const read = createReadDb()
const hash = vi.fn()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    passwordResetTokens: table('tokens', ['tokenHash', 'userId', 'expiresAt']),
    users: table('users', ['id', 'isActive', 'isDeleted']),
}))
vi.mock('@/lib/Auth/tokens.ts', () => ({ createTokenHash: hash }))
const { validatePasswordResetTokenService } =
    await import('@/server/Auth/PasswordReset/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    hash.mockReset().mockResolvedValue('synthetic-token-hash')
    read.results.length = 0
    read.queries.length = 0
})

it('matches the hashed token and requires a future expiry and active, non-deleted account', async () => {
    read.results.push([{ tokenHash: 'synthetic-token-hash' }])
    expect(
        await validatePasswordResetTokenService('synthetic-reset-token'),
    ).toEqual({ valid: true, length: 1 })
    expect(hash).toHaveBeenCalledWith('synthetic-reset-token')
    expect(read.queries[0]?.where).toHaveBeenCalledWith({
        op: 'and',
        conditions: [
            {
                op: 'eq',
                left: 'tokens.tokenHash',
                right: 'synthetic-token-hash',
            },
            { op: 'gt', left: 'tokens.expiresAt', right: expect.any(Date) },
            { op: 'eq', left: 'users.isActive', right: true },
            { op: 'eq', left: 'users.isDeleted', right: false },
        ],
    })
    expect(read.queries[0]?.limit).toHaveBeenCalledWith(1)
})

it('reports invalid when the token is absent, expired or belongs to an ineligible account', async () => {
    expect(
        await validatePasswordResetTokenService('synthetic-reset-token'),
    ).toEqual({ valid: false, length: 0 })
})

it('propagates hashing errors without attempting an unhashed lookup', async () => {
    hash.mockRejectedValue(new Error('Hash unavailable'))
    await expect(
        validatePasswordResetTokenService('synthetic-reset-token'),
    ).rejects.toThrow('Hash unavailable')
    expect(read.db.select).not.toHaveBeenCalled()
})
