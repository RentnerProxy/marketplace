import { queryOptions } from '@tanstack/react-query'
import { getSystemSettingsHandler } from '@/features/Admin/SystemSettings/middleware.ts'
import { validateSessionHandler } from '@/features/Auth/middleware.ts'
import {
    AUTHENTICATED_SESSION_QUERY_KEY,
    removeStaleAuthenticatedQueryData,
} from './authenticatedSessionCache.ts'

export { AUTHENTICATED_SESSION_QUERY_KEY } from './authenticatedSessionCache.ts'

export const SYSTEM_SETTINGS_QUERY_KEY = ['system-settings'] as const
export const ADMIN_SYSTEM_SETTINGS_QUERY_KEY = [
    'system-settings',
    'admin',
] as const

export function profileImageVersionQueryKey(userId: string | undefined) {
    return ['profile-image-version', userId] as const
}

export function systemSettingsQueryOptions() {
    return queryOptions({
        queryKey: SYSTEM_SETTINGS_QUERY_KEY,
        queryFn: getSystemSettingsHandler,
    })
}

export function authenticatedSessionQueryOptions() {
    return queryOptions({
        queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
        queryFn: async function ({ client, signal }) {
            const session = await validateSessionHandler({ signal })
            if (!signal.aborted) {
                removeStaleAuthenticatedQueryData(client, session)
            }
            return session
        },
    })
}
