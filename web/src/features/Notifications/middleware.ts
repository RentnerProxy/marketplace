import { createServerFn } from '@tanstack/react-start'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { getNotificationsService } from '@/server/Notifications/get.service.ts'
import {
    markAllNotificationsAsReadService,
    markNotificationAsReadService,
} from '@/server/Notifications/update.service.ts'
import { markNotificationAsReadInputSchema } from './validation.ts'

export const getNotificationsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    const { sessionUser: user } =
        await requireAuthenticatedFeatureAccessService()
    return getNotificationsService(user.id)
})

export const markNotificationAsReadHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return markNotificationAsReadInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const { sessionUser: user } =
            await requireAuthenticatedFeatureAccessService()
        await markNotificationAsReadService(user.id, data.notificationId)
        return { success: true }
    })

export const markAllNotificationsAsReadHandler = createServerFn({
    method: 'POST',
}).handler(async function () {
    const { sessionUser: user } =
        await requireAuthenticatedFeatureAccessService()
    await markAllNotificationsAsReadService(user.id)
    return { success: true }
})
