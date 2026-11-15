import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
    Notification,
    NotificationTab,
} from './notification-domain.types.ts'

export type NotificationsLogicReturn = {
    state: {
        activeTab: NotificationTab
        dateFormatter: Intl.DateTimeFormat
        filteredNotifications: Array<Notification>
        isLoading: boolean
        isMarkingAllAsRead: boolean
        markingNotificationId: string | null
        unreadCount: number
        isOpen: boolean
    }
    handler: {
        handleMarkAllAsRead: () => void
        handleMarkAsRead: (notificationId: string) => void
        handleTabChange: (tab: NotificationTab) => void
        handleToggle: () => void
    }
    setter: {
        setIsOpen: Dispatch<SetStateAction<boolean>>
    }
    refs: {
        notificationsRef: RefObject<HTMLDivElement | null>
    }
}
