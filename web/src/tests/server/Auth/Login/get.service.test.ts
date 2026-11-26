import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../../Admin/AuditLogs/read-query.test.helpers.ts'
import { TRUSTED_DEVICE_COOKIE_NAME } from '@/config/session.config.ts'

const read = createReadDb()
const cookie = vi.fn()
const hash = vi.fn()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    trustedDevices: table('trustedDevices', [
        'expiresAt',
        'deviceTokenHash',
        'userId',
    ]),
}))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: cookie }))
vi.mock('@/lib/Auth/tokens.ts', () => ({ createTokenHash: hash }))
const { hasTrustedDevice } = await import('@/server/Auth/Login/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    cookie.mockReset().mockReturnValue('synthetic-device-token')
    hash.mockReset().mockResolvedValue('synthetic-token-hash')
    read.results.length = 0
    read.queries.length = 0
})

describe('trusted device lookup', () => {
    it('does not hash or query when the trusted-device cookie is absent', async () => {
        cookie.mockReturnValue(undefined)
        expect(await hasTrustedDevice('owner')).toBe(false)
        expect(cookie).toHaveBeenCalledWith(TRUSTED_DEVICE_COOKIE_NAME)
        expect(hash).not.toHaveBeenCalled()
        expect(read.db.select).not.toHaveBeenCalled()
    })

    it('requires an unexpired record belonging to both the token hash and current user', async () => {
        read.results.push([{ expiresAt: new Date(Date.now() + 60_000) }])
        expect(await hasTrustedDevice('owner')).toBe(true)
        expect(hash).toHaveBeenCalledWith('synthetic-device-token')
        expect(read.queries[0]?.where).toHaveBeenCalledWith({
            op: 'and',
            conditions: [
                {
                    op: 'eq',
                    left: 'trustedDevices.deviceTokenHash',
                    right: 'synthetic-token-hash',
                },
                { op: 'eq', left: 'trustedDevices.userId', right: 'owner' },
            ],
        })
        expect(read.queries[0]?.limit).toHaveBeenCalledWith(1)
    })

    it('rejects expired devices and unknown tokens', async () => {
        read.results.push([{ expiresAt: new Date(Date.now() - 60_000) }], [])
        expect(await hasTrustedDevice('owner')).toBe(false)
        expect(await hasTrustedDevice('owner')).toBe(false)
    })

    it('propagates hash failure without querying the database', async () => {
        hash.mockRejectedValue(new Error('Hash unavailable'))
        await expect(hasTrustedDevice('owner')).rejects.toThrow(
            'Hash unavailable',
        )
        expect(read.db.select).not.toHaveBeenCalled()
    })
})
