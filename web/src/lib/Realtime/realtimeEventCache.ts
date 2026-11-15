import type { QueryClient } from '@tanstack/react-query'
import type { Notification } from '@/features/Notifications/Types/notification-domain.types.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { SessionUserCacheUpdate } from './Types/realtime-event-cache.types.ts'
import {
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
    AUTHENTICATED_SESSION_QUERY_KEY,
    SYSTEM_SETTINGS_QUERY_KEY,
} from '@/lib/Queries/appQueries.ts'

export function getSessionQueryData(queryClient: QueryClient) {
    return queryClient.getQueryData<AuthenticatedSessionQueryData>(
        AUTHENTICATED_SESSION_QUERY_KEY,
    )
}

export function updateSessionUserCache(
    queryClient: QueryClient,
    payload: SessionUserCacheUpdate,
) {
    queryClient.setQueryData<AuthenticatedSessionQueryData | undefined>(
        AUTHENTICATED_SESSION_QUERY_KEY,
        (current) => {
            if (!current?.user || current.user.id !== payload.userId) {
                return current
            }

            return {
                ...current,
                user: {
                    ...current.user,
                    username: payload.username,
                },
                permissions: payload.permissionKeys,
            }
        },
    )
}

export function updateSystemSettingsCache(
    queryClient: QueryClient,
    values: Record<string, unknown>,
) {
    queryClient.setQueryData(SYSTEM_SETTINGS_QUERY_KEY, (current) => ({
        ...(typeof current === 'object' && current ? current : {}),
        ...values,
    }))
}

export function updateAdminSystemSettingsCache(
    queryClient: QueryClient,
    values: Record<string, unknown>,
) {
    queryClient.setQueryData(ADMIN_SYSTEM_SETTINGS_QUERY_KEY, (current) => ({
        ...(typeof current === 'object' && current ? current : {}),
        ...values,
    }))
}

export function addNotificationToCache(
    queryClient: QueryClient,
    notification: Notification,
) {
    queryClient.setQueryData<Array<Notification>>(
        ['notifications'],
        (current = []) => {
            if (current.some((item) => item.id === notification.id)) {
                return current
            }

            return [notification, ...current]
        },
    )
}
