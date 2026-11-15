import { z } from 'zod'

export const markNotificationAsReadInputSchema = z.object({
    notificationId: z.uuidv7(),
})
