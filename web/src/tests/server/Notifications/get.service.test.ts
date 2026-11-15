import { beforeEach, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../Admin/AuditLogs/read-query.test.helpers.ts'

const read = createReadDb()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    notifications: table('notifications', [
        'id',
        'userId',
        'title',
        'message',
        'type',
        'referenceId',
        'isRead',
        'readAt',
        'createdAt',
    ]),
}))
const { getNotificationsService } =
    await import('@/server/Notifications/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    read.results.length = 0
    read.queries.length = 0
})

it('reads only the requested user notifications, newest first with a bounded result size', async () => {
    const createdAt = new Date('2026-01-01T12:00:00Z')
    read.results.push([
        {
            id: 'unread',
            title: 'Notice',
            message: 'Message',
            type: 'info',
            referenceId: null,
            isRead: false,
            readAt: null,
            createdAt,
        },
        {
            id: 'read',
            title: 'Notice',
            message: 'Message',
            type: 'info',
            referenceId: 'item',
            isRead: true,
            readAt: createdAt,
            createdAt,
        },
    ])
    const result = await getNotificationsService('owner')
    expect(result[0]).toMatchObject({
        id: 'unread',
        readAt: null,
        createdAt: createdAt.toISOString(),
    })
    expect(result[1]).toMatchObject({
        id: 'read',
        readAt: createdAt.toISOString(),
        referenceId: 'item',
    })
    expect(read.queries[0]?.where).toHaveBeenCalledWith({
        op: 'eq',
        left: 'notifications.userId',
        right: 'owner',
    })
    expect(read.queries[0]?.orderBy).toHaveBeenCalledWith({
        op: 'desc',
        column: 'notifications.createdAt',
    })
    expect(read.queries[0]?.limit).toHaveBeenCalledWith(100)
})

it('returns an empty notification list without manufacturing entries', async () => {
    expect(await getNotificationsService('owner')).toEqual([])
})
