import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getNotificationsHandler,
    markAllNotificationsAsReadHandler,
    markNotificationAsReadHandler,
} from '../middleware.ts'
import type { Notification } from '../Types/notification-domain.types.ts'
import type { NotificationsLogicReturn } from '../Types/notification-logic.types.ts'
const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const

const EMPTY_NOTIFICATIONS: Array<Notification> = []

export default function useNotificationsLogic(): NotificationsLogicReturn {
    const { language, t } = useTranslationStore()
    const queryClient = useQueryClient()
    const notificationsRef = useRef<HTMLDivElement>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'unread' | 'read'>('unread')
    const dateFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(language, {
                dateStyle: 'medium',
                timeStyle: 'short',
            }),
        [language],
    )

    const notificationsQuery = useQuery({
        queryKey: NOTIFICATIONS_QUERY_KEY,
        queryFn: getNotificationsHandler,
    })

    const markAsReadMutation = useMutation({
        mutationFn: async function (notificationId: string) {
            await markNotificationAsReadHandler({
                data: { notificationId },
            })
            return notificationId
        },
        onSuccess: function (notificationId) {
            queryClient.setQueryData<Array<Notification>>(
                NOTIFICATIONS_QUERY_KEY,
                (current = []) =>
                    current.map((notification) =>
                        notification.id === notificationId
                            ? {
                                  ...notification,
                                  isRead: true,
                                  readAt: new Date().toISOString(),
                              }
                            : notification,
                    ),
            )
        },
        onError: function () {
            toast.error(t('notifications.updateError'), {
                title: t('notifications.title'),
            })
        },
    })

    const markAllAsReadMutation = useMutation({
        mutationFn: async function () {
            await markAllNotificationsAsReadHandler()
        },
        onSuccess: function () {
            const readAt = new Date().toISOString()
            queryClient.setQueryData<Array<Notification>>(
                NOTIFICATIONS_QUERY_KEY,
                (current = []) =>
                    current.map((notification) => ({
                        ...notification,
                        isRead: true,
                        readAt: notification.readAt ?? readAt,
                    })),
            )
        },
        onError: function () {
            toast.error(t('notifications.updateError'), {
                title: t('notifications.title'),
            })
        },
    })

    const notifications = notificationsQuery.data ?? EMPTY_NOTIFICATIONS
    const unreadCount = notifications.filter(
        (notification) => !notification.isRead,
    ).length
    const filteredNotifications = useMemo(
        () =>
            notifications.filter((notification) =>
                activeTab === 'read'
                    ? notification.isRead
                    : !notification.isRead,
            ),
        [activeTab, notifications],
    )

    useEffect(() => {
        if (!isOpen) {
            return undefined
        }

        function handlePointerDown(event: PointerEvent) {
            if (
                event.target instanceof Node &&
                !notificationsRef.current?.contains(event.target)
            ) {
                setIsOpen(false)
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return function () {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen])

    function handleToggle() {
        setIsOpen((current) => !current)
    }

    const handleTabChange: (tab: 'unread' | 'read') => void = setActiveTab

    function handleMarkAsRead(notificationId: string) {
        markAsReadMutation.mutate(notificationId)
    }

    function handleMarkAllAsRead() {
        markAllAsReadMutation.mutate()
    }

    return {
        state: {
            activeTab,
            dateFormatter,
            filteredNotifications,
            isLoading: notificationsQuery.isLoading,
            isMarkingAllAsRead: markAllAsReadMutation.isPending,
            markingNotificationId: markAsReadMutation.isPending
                ? markAsReadMutation.variables
                : null,
            unreadCount,
            isOpen,
        },
        handler: {
            handleMarkAllAsRead,
            handleMarkAsRead,
            handleTabChange,
            handleToggle,
        },
        setter: {
            setIsOpen,
        },
        refs: { notificationsRef },
    }
}
