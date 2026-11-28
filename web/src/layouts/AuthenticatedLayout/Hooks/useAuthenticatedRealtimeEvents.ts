import { scheduleCancelableTimeout } from '@/lib/Browser/scheduleCancelableTimeout.ts'
import { toast } from '@rentnerkev/toasts'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { validateSessionHandler } from '@/features/Auth/middleware.ts'
import { sessionConfig } from '@/config/session.config.ts'
import { revalidateCurrentSession } from '@/lib/Queries/sessionRevalidation.ts'
import { createSessionRevocationController } from '@/lib/Auth/Session/sessionRevocation.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getCurrentBrowserPath } from '@/lib/Browser/browser.ts'
import {
    reconnectRealtimeEvents,
    subscribeToRealtimeEvents,
} from '@/websockets/Client/realtimeEventsClient.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { resetAppThemeSettings } from '@/lib/Theme/appTheme.ts'
import {
    addNotificationToCache,
    getSessionQueryData,
    updateAdminSystemSettingsCache,
    updateSessionUserCache,
    updateSystemSettingsCache,
} from '@/lib/Realtime/realtimeEventCache.ts'
import { shouldReconnectForPermissionChange } from '@/lib/Permissions/realtimeEventPermissions.ts'
import { rememberMaintenanceReturnPath } from '@/lib/Maintenance/maintenanceReturnPath.ts'
import { SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'

export default function useAuthenticatedRealtimeEvents() {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const { t } = useTranslationStore()

    useEffect(() => {
        let disposed = false
        const revocations = createSessionRevocationController({
            queryClient,
            validate(signal) {
                return revalidateCurrentSession({
                    queryClient,
                    signal,
                    readSession: (requestSignal) =>
                        validateSessionHandler({ signal: requestSignal }),
                    onInactive() {
                        if (disposed) return
                        resetAppThemeSettings()
                        void navigate({ to: '/login' }).catch(function () {})
                    },
                    requestTimeoutMs: sessionConfig.activityRequestTimeoutMs,
                    schedule: scheduleCancelableTimeout,
                })
            },
            monotonicNow: () => performance.now(),
            throttleMs: sessionConfig.activityThrottleMs,
            schedule: scheduleCancelableTimeout,
        })
        const unsubscribe = subscribeToRealtimeEvents(
            async function (realtimeEvent) {
                if (realtimeEvent.type === 'connection.ready') {
                    await queryClient.invalidateQueries()
                    return
                }

                if (
                    realtimeEvent.type === 'realtime.reauthentication-required'
                ) {
                    return
                }

                if (
                    realtimeEvent.type === 'user.sessions-revoked' ||
                    realtimeEvent.type === 'session.revoked'
                ) {
                    revocations.request(realtimeEvent.payload.userId)
                    return
                }

                if (realtimeEvent.type === 'notification.created') {
                    addNotificationToCache(
                        queryClient,
                        realtimeEvent.payload.notification,
                    )
                }

                if (realtimeEvent.type === 'system-settings.updated') {
                    if (
                        realtimeEvent.payload.isPublicRegistrationEnabled ===
                        undefined
                    ) {
                        updateSystemSettingsCache(
                            queryClient,
                            realtimeEvent.payload,
                        )
                    } else {
                        // Concurrent writes can publish out of order. Reload both settings queries.
                        await queryClient.invalidateQueries({
                            queryKey: SYSTEM_SETTINGS_QUERY_KEY,
                        })
                    }
                }

                if (realtimeEvent.type === 'maintenance-mode.changed') {
                    const session = getSessionQueryData(queryClient)
                    const canBypassMaintenance = hasPermission(
                        session?.permissions,
                        PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
                    )

                    updateSystemSettingsCache(queryClient, {
                        ...realtimeEvent.payload,
                        ...(realtimeEvent.payload.isMaintenanceModeEnabled
                            ? {}
                            : { pendingMaintenanceExtensionRequest: null }),
                    })

                    if (
                        realtimeEvent.payload.isMaintenanceModeActive &&
                        !canBypassMaintenance
                    ) {
                        rememberMaintenanceReturnPath()
                        await navigate({
                            to: '/maintenance',
                            search: {
                                redirect: getCurrentBrowserPath() ?? undefined,
                            },
                        })
                    }
                }

                if (realtimeEvent.type === 'maintenance-extension.resolved') {
                    const session = getSessionQueryData(queryClient)

                    updateSystemSettingsCache(queryClient, {
                        maintenanceStartsAt:
                            realtimeEvent.payload.maintenanceStartsAt,
                        isMaintenanceModeScheduled: Boolean(
                            realtimeEvent.payload.maintenanceStartsAt &&
                            new Date(
                                realtimeEvent.payload.maintenanceStartsAt,
                            ) > new Date(),
                        ),
                        isMaintenanceModeActive: Boolean(
                            realtimeEvent.payload.maintenanceStartsAt &&
                            new Date(
                                realtimeEvent.payload.maintenanceStartsAt,
                            ) <= new Date(),
                        ),
                    })
                    updateAdminSystemSettingsCache(queryClient, {
                        pendingMaintenanceExtensionRequest: null,
                    })

                    if (session?.user?.id !== realtimeEvent.payload.userId) {
                        return
                    }

                    if (realtimeEvent.payload.status === 'approved') {
                        toast.success(t('maintenance.extensionApproved'), {
                            title: t('maintenance.title'),
                        })
                    } else {
                        toast.error(t('maintenance.extensionRejected'), {
                            title: t('maintenance.title'),
                        })
                    }
                }

                if (realtimeEvent.type === 'maintenance-extension.requested') {
                    const session = getSessionQueryData(queryClient)

                    updateAdminSystemSettingsCache(queryClient, {
                        pendingMaintenanceExtensionRequest:
                            realtimeEvent.payload.request,
                    })

                    if (
                        session?.user?.id !==
                            realtimeEvent.payload.request.user.id &&
                        hasPermission(
                            session?.permissions,
                            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
                        )
                    ) {
                        toast.info(
                            t('maintenance.adminExtensionRequested', {
                                username:
                                    realtimeEvent.payload.request.user.username,
                            }),
                            { title: t('maintenance.title') },
                        )
                    }
                }

                if (realtimeEvent.type === 'user.updated') {
                    const session = getSessionQueryData(queryClient)
                    const currentUserId = session?.user?.id

                    if (currentUserId !== realtimeEvent.payload.userId) {
                        return
                    }

                    updateSessionUserCache(queryClient, {
                        userId: realtimeEvent.payload.userId,
                        username: realtimeEvent.payload.username,
                        permissionKeys: realtimeEvent.payload.permissionKeys,
                    })

                    if (
                        realtimeEvent.payload.username !==
                        realtimeEvent.payload.previousUsername
                    ) {
                        toast.info(
                            t('toast.usernameChanged', {
                                username: realtimeEvent.payload.username,
                            }),
                            { title: t('userSettings.header.title') },
                        )
                    }

                    if (realtimeEvent.payload.addedPermissionKeys.length > 0) {
                        toast.info(
                            t('toast.permissionsAdded', {
                                permissions:
                                    realtimeEvent.payload.addedPermissionKeys.join(
                                        ', ',
                                    ),
                            }),
                            { title: t('toast.permissionsAddedTitle') },
                        )
                    }

                    if (
                        shouldReconnectForPermissionChange(
                            realtimeEvent.payload.previousPermissionKeys,
                            realtimeEvent.payload.permissionKeys,
                        )
                    ) {
                        reconnectRealtimeEvents()
                    }
                }

                if (realtimeEvent.type === 'user.access-revoked') {
                    const session = getSessionQueryData(queryClient)
                    const currentUserId = session?.user?.id

                    if (currentUserId !== realtimeEvent.payload.userId) {
                        return
                    }

                    toast.info(
                        realtimeEvent.payload.reason === 'deleted'
                            ? t('toast.accountDeleted')
                            : t('toast.accountBlocked'),
                        { title: t('toast.sessionEndedTitle') },
                    )

                    revocations.request(realtimeEvent.payload.userId)
                }
            },
        )
        return function () {
            disposed = true
            unsubscribe()
            revocations.dispose()
        }
    }, [navigate, queryClient, t])
}
