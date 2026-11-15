import type { Database } from '@/lib/Database/Types/database.types.ts'

export type CreateNotificationInput = {
    userId: string
    title: string
    message: string
    type: string
    referenceId?: string
}

export type NotificationWriter = Pick<Database, 'insert'>
