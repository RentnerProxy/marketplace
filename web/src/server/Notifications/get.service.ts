import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { notifications } from '@/db/schema.ts'

export async function getNotificationsService(userId: string) {
    const result = await db
        .select({
            id: notifications.id,
            title: notifications.title,
            message: notifications.message,
            type: notifications.type,
            referenceId: notifications.referenceId,
            isRead: notifications.isRead,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(100)

    return result.map(function (notification) {
        const { createdAt, readAt, ...notificationData } = notification

        return Object.assign(notificationData, {
            readAt: readAt?.toISOString() ?? null,
            createdAt: createdAt.toISOString(),
        })
    })
}
