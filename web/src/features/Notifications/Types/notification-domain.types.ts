export type Notification = {
    id: string
    title: string
    message: string
    type: string
    referenceId: string | null
    isRead: boolean
    readAt: string | null
    createdAt: string
}

export type NotificationTab = 'unread' | 'read'
