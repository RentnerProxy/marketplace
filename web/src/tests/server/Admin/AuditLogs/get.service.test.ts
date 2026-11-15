import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createReadDb, operators, table } from './read-query.test.helpers.ts'

const read = createReadDb()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    auditLogs: table('audit', [
        'id',
        'action',
        'actorUserId',
        'message',
        'route',
        'method',
        'oldValues',
        'newValues',
        'createdAt',
    ]),
    users: table('users', ['id', 'username']),
}))
const { getAuditLogsService } =
    await import('@/server/Admin/AuditLogs/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    read.results.length = 0
    read.queries.length = 0
})

describe('audit log reads', () => {
    it('limits ordered audit history and converts Dates and JSON values to serializable output', async () => {
        const createdAt = new Date('2026-01-01T12:00:00Z')
        read.results.push([
            {
                id: 'event',
                action: 'user.updated',
                actorUserId: 'actor',
                actorUsername: 'Ada',
                message: 'Updated',
                route: '/users',
                method: 'POST',
                createdAt,
                oldValues: { updatedAt: createdAt, omitted: undefined },
                newValues: { enabled: true, nested: [1, null] },
            },
            {
                id: 'system',
                action: 'worker.started',
                actorUserId: null,
                actorUsername: null,
                message: null,
                route: null,
                method: null,
                createdAt,
                oldValues: null,
                newValues: null,
            },
        ])
        const result = await getAuditLogsService()
        expect(result[0]).toMatchObject({
            createdAt: createdAt.toISOString(),
            oldValues: { updatedAt: createdAt.toISOString() },
            newValues: { enabled: true, nested: [1, null] },
        })
        expect(result[1]).toMatchObject({
            actorUsername: null,
            oldValues: null,
            newValues: null,
        })
        expect(read.queries[0]?.limit).toHaveBeenCalledWith(500)
        expect(read.queries[0]?.orderBy).toHaveBeenCalledWith({
            op: 'desc',
            column: 'audit.createdAt',
        })
        expect(read.queries[0]?.leftJoin).toHaveBeenCalledWith(
            expect.anything(),
            { op: 'eq', left: 'users.id', right: 'audit.actorUserId' },
        )
    })

    it('returns an empty history when no records exist', async () => {
        read.results.push([])
        expect(await getAuditLogsService()).toEqual([])
    })

    it('rejects unserializable stored values instead of returning invalid transport data', async () => {
        read.results.push([
            {
                createdAt: new Date(),
                oldValues: { invalid: 1n },
                newValues: null,
            },
        ])
        await expect(getAuditLogsService()).rejects.toThrow()
    })
})
