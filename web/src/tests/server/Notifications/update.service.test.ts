import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@/db'
import { publishNotificationCreatedService } from '@/server/Realtime/publish.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import {
    createNotificationsService,
    createPermissionsAddedNotificationInTransactionService,
    publishCommittedNotificationsService,
    markAllNotificationsAsReadService,
    markNotificationAsReadService,
} from '@/server/Notifications/update.service.ts'

const schemaMock = (function () {
    return {
        notifications: {
            id: 'notifications.id',
            userId: 'notifications.userId',
            title: 'notifications.title',
            message: 'notifications.message',
            type: 'notifications.type',
            referenceId: 'notifications.referenceId',
            isRead: 'notifications.isRead',
            readAt: 'notifications.readAt',
            createdAt: 'notifications.createdAt',
        },
    }
})()

const dbMock = (function () {
    const state = {
        created: [] as Array<Record<string, unknown>>,
    }
    const returning = vi.fn(async function () {
        return state.created
    })
    const values = vi.fn(function () {
        return { returning }
    })
    const where = vi.fn(async function () {})
    const set = vi.fn(function () {
        return { where }
    })
    const database = {
        insert: vi.fn(function () {
            return { values }
        }),
        update: vi.fn(function () {
            return { set }
        }),
    }

    return { database, returning, set, state, values, where }
})()

vi.mock('@/db', function () {
    return { db: dbMock.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
    }
})

vi.mock('@/server/Realtime/publish.service.ts', function () {
    return { publishNotificationCreatedService: vi.fn(async function () {}) }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

function createdNotification(overrides: Record<string, unknown> = {}) {
    return {
        id: 'notification-1',
        userId: 'user-1',
        title: 'Titel',
        message: 'Nachricht',
        type: 'info',
        referenceId: null,
        isRead: false,
        readAt: null,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        ...overrides,
    }
}

const mockedPublishNotificationCreated =
    publishNotificationCreatedService as Mock<
        typeof publishNotificationCreatedService
    >

describe('Notification-Services', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        dbMock.state.created = []
    })

    it('überspringt einen leeren Batch ohne Datenbankzugriff', async function () {
        await expect(createNotificationsService([])).resolves.toEqual([])
        expect(db.insert).not.toHaveBeenCalled()
    })

    it('persistiert und serialisiert einen vollständigen Batch', async function () {
        dbMock.state.created = [
            createdNotification(),
            createdNotification({
                id: 'notification-2',
                userId: 'user-2',
                readAt: new Date('2026-01-02T12:00:00.000Z'),
            }),
        ]
        const input = [
            {
                userId: 'user-1',
                title: 'Titel',
                message: 'Nachricht',
                type: 'info',
            },
            {
                userId: 'user-2',
                title: 'Zweiter Titel',
                message: 'Zweite Nachricht',
                type: 'warning',
                referenceId: 'reference-1',
            },
        ]

        const result = await createNotificationsService(input)

        expect(dbMock.values).toHaveBeenCalledWith([
            { ...input[0], referenceId: undefined },
            input[1],
        ])
        expect(result).toEqual([
            expect.objectContaining({
                id: 'notification-1',
                readAt: null,
                createdAt: '2026-01-01T12:00:00.000Z',
            }),
            expect.objectContaining({
                id: 'notification-2',
                readAt: '2026-01-02T12:00:00.000Z',
            }),
        ])
        expect(publishNotificationCreatedService).toHaveBeenCalledTimes(2)
        expect(publishNotificationCreatedService).toHaveBeenCalledWith({
            userId: 'user-1',
            notification: result[0],
        })
    })

    it('liefert trotz Realtime-Ausfall die persistierte Benachrichtigung', async function () {
        dbMock.state.created = [createdNotification()]
        const publishError = new Error('Realtime offline')
        mockedPublishNotificationCreated.mockRejectedValueOnce(publishError)

        const result = await createNotificationsService([
            {
                userId: 'user-1',
                title: 'Titel',
                message: 'Nachricht',
                type: 'info',
            },
        ])

        expect(result).toEqual([
            expect.objectContaining({ id: 'notification-1' }),
        ])
        expect(logError).toHaveBeenCalledWith(
            'notification.realtime_publish_failed',
            publishError,
            {
                notificationId: 'notification-1',
                userId: 'user-1',
            },
        )
    })

    it('weist unvollständige Insert-Ergebnisse zurück', async function () {
        dbMock.state.created = []
        dbMock.state.created.length = 1
        await expect(
            createPermissionsAddedNotificationInTransactionService(
                dbMock.database as never,
                'user-1',
                ['admin.users'],
            ),
        ).rejects.toThrow('konnte nicht erstellt')

        dbMock.state.created = [createdNotification()]
        await expect(
            createNotificationsService([
                {
                    userId: 'user-1',
                    title: 'Eins',
                    message: 'Eins',
                    type: 'info',
                },
                {
                    userId: 'user-2',
                    title: 'Zwei',
                    message: 'Zwei',
                    type: 'info',
                },
            ]),
        ).rejects.toThrow('Nicht alle Benachrichtigungen')
    })

    it('weist ein Insert-Ergebnis ohne Benutzerbezug zurück', async function () {
        dbMock.state.created = [createdNotification({ userId: null })]

        await expect(
            createNotificationsService([
                {
                    userId: 'user-1',
                    title: 'Titel',
                    message: 'Nachricht',
                    type: 'info',
                },
            ]),
        ).rejects.toThrow('keinen Benutzer')
    })

    it('persistiert die Pflichtnotification ausschließlich über die übergebene Transaktion und veröffentlicht separat', async function () {
        dbMock.state.created = [createdNotification()]
        const transaction = {
            insert: vi.fn(function () {
                return { values: dbMock.values }
            }),
        }
        const notification =
            await createPermissionsAddedNotificationInTransactionService(
                transaction as never,
                'user-1',
                ['admin.users', 'admin.system'],
            )

        expect(transaction.insert).toHaveBeenCalledWith(
            schemaMock.notifications,
        )
        expect(db.insert).not.toHaveBeenCalled()
        expect(dbMock.values).toHaveBeenCalledWith([
            {
                userId: 'user-1',
                title: 'Neue Rechte',
                message:
                    'Dir wurden neue Rechte zugewiesen: admin.users, admin.system',
                type: 'permissions-added',
                referenceId: undefined,
            },
        ])
        expect(publishNotificationCreatedService).not.toHaveBeenCalled()

        await publishCommittedNotificationsService([notification])
        expect(publishNotificationCreatedService).toHaveBeenCalledTimes(1)
        expect(publishNotificationCreatedService).toHaveBeenCalledWith({
            userId: 'user-1',
            notification,
        })
        expect(transaction.insert).toHaveBeenCalledTimes(1)
        expect(db.insert).not.toHaveBeenCalled()
    })

    it('wirft bei fehlender Pflichtnotification ohne globale Ersatzpersistenz oder Publisher', async function () {
        const transaction = {
            insert: vi.fn(function () {
                return { values: dbMock.values }
            }),
        }
        await expect(
            createPermissionsAddedNotificationInTransactionService(
                transaction as never,
                'user-1',
                ['admin.users'],
            ),
        ).rejects.toThrow('Nicht alle Benachrichtigungen')
        expect(transaction.insert).toHaveBeenCalledTimes(1)
        expect(db.insert).not.toHaveBeenCalled()
        expect(publishNotificationCreatedService).not.toHaveBeenCalled()
    })

    it('markiert eine oder alle eigenen Benachrichtigungen als gelesen', async function () {
        await markNotificationAsReadService('user-1', 'notification-1')
        await markAllNotificationsAsReadService('user-1')

        expect(dbMock.set).toHaveBeenCalledTimes(2)
        expect(dbMock.set).toHaveBeenNthCalledWith(1, {
            isRead: true,
            readAt: expect.any(Date),
        })
        expect(dbMock.where).toHaveBeenNthCalledWith(1, {
            type: 'and',
            conditions: [
                {
                    type: 'eq',
                    left: schemaMock.notifications.id,
                    right: 'notification-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.notifications.userId,
                    right: 'user-1',
                },
            ],
        })
        expect(dbMock.where).toHaveBeenNthCalledWith(2, {
            type: 'and',
            conditions: [
                {
                    type: 'eq',
                    left: schemaMock.notifications.userId,
                    right: 'user-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.notifications.isRead,
                    right: false,
                },
            ],
        })
    })
})
