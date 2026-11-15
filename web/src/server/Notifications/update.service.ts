import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { notifications } from '@/db/schema.ts'
import { publishNotificationCreatedService } from '@/server/Realtime/publish.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import type {
    CreateNotificationInput,
    NotificationWriter,
} from './Types/notification.types.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

export async function createNotificationsService(
    data: Array<CreateNotificationInput>,
) {
    const createdNotifications = await persistNotifications(db, data)
    await publishCommittedNotificationsService(createdNotifications)
    return createdNotifications
}

export async function createPermissionsAddedNotificationInTransactionService(
    transaction: DatabaseTransaction,
    userId: string,
    permissionKeys: Array<string>,
) {
    const created = await persistNotifications(transaction, [
        {
            userId,
            title: 'Neue Rechte',
            message: `Dir wurden neue Rechte zugewiesen: ${permissionKeys.join(', ')}`,
            type: 'permissions-added',
        },
    ])
    const notification = created.at(0)
    if (!notification) {
        throw new Error('Die Benachrichtigung konnte nicht erstellt werden.')
    }
    return notification
}

async function persistNotifications(
    database: NotificationWriter,
    data: Array<CreateNotificationInput>,
) {
    if (data.length === 0) {
        return []
    }

    const createdNotifications = await database
        .insert(notifications)
        .values(
            data.map((item) => ({
                userId: item.userId,
                title: item.title,
                message: item.message,
                type: item.type,
                referenceId: item.referenceId,
            })),
        )
        .returning({
            id: notifications.id,
            userId: notifications.userId,
            title: notifications.title,
            message: notifications.message,
            type: notifications.type,
            referenceId: notifications.referenceId,
            isRead: notifications.isRead,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
        })
    if (createdNotifications.length !== data.length) {
        throw new Error(
            'Nicht alle Benachrichtigungen konnten erstellt werden.',
        )
    }

    return createdNotifications.map(function (notification) {
        if (!notification.userId) {
            throw new Error(
                'Die erstellte Benachrichtigung hat keinen Benutzer.',
            )
        }

        return {
            id: notification.id,
            userId: notification.userId,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            referenceId: notification.referenceId,
            isRead: notification.isRead,
            readAt: notification.readAt?.toISOString() ?? null,
            createdAt: notification.createdAt.toISOString(),
        }
    })
}

export async function publishCommittedNotificationsService(
    serializedNotifications: Awaited<ReturnType<typeof persistNotifications>>,
) {
    await Promise.all(
        serializedNotifications.map(async function (notification) {
            try {
                await publishNotificationCreatedService({
                    userId: notification.userId,
                    notification,
                })
            } catch (error) {
                logError('notification.realtime_publish_failed', error, {
                    notificationId: notification.id,
                    userId: notification.userId,
                })
            }
        }),
    )
}

export async function markNotificationAsReadService(
    userId: string,
    notificationId: string,
) {
    await db
        .update(notifications)
        .set({
            isRead: true,
            readAt: new Date(),
        })
        .where(
            and(
                eq(notifications.id, notificationId),
                eq(notifications.userId, userId),
            ),
        )
}

export async function markAllNotificationsAsReadService(userId: string) {
    await db
        .update(notifications)
        .set({
            isRead: true,
            readAt: new Date(),
        })
        .where(
            and(
                eq(notifications.userId, userId),
                eq(notifications.isRead, false),
            ),
        )
}
