import { toast } from '@rentnerkev/toasts'
import { useCallback, useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import { getMaintenancePageStatusHandler } from '../middleware.ts'
import type {
    MaintenanceLogicReturn,
    MaintenancePageStatus,
} from '../Types/types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    clearStoredMaintenanceReturnPath,
    getStoredMaintenanceReturnPath,
} from '@/lib/Maintenance/maintenanceReturnPath.ts'
import useRestoreNavigationBridge from '@/shared/Restore/Hooks/useRestoreNavigationBridge.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

const MAINTENANCE_PAGE_STATUS_QUERY_KEY = ['maintenance-page-status']

export default function useMaintenanceLogic(): MaintenanceLogicReturn {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { t } = useTranslationStore()
    const search = useSearch({ strict: false })
    const statusQuery = useQuery({
        queryKey: MAINTENANCE_PAGE_STATUS_QUERY_KEY,
        queryFn: getMaintenancePageStatusHandler,
    })
    const status = statusQuery.data
    const redirectTarget =
        search.redirect ||
        getStoredMaintenanceReturnPath() ||
        status?.redirectTo ||
        '/login'

    useRestoreNavigationBridge({
        returnPath: redirectTarget,
        preRestoreUserId: status?.user?.id,
        isPreRestoreIdentityResolved: !statusQuery.isPending,
    })

    const navigateBackFromMaintenance = useCallback(
        async function () {
            clearStoredMaintenanceReturnPath()
            await navigate({ href: redirectTarget })
        },
        [navigate, redirectTarget],
    )

    useEffect(() => {
        if (!status || status.isMaintenanceActive) {
            return
        }

        void navigateBackFromMaintenance().catch(toastAppError)
    }, [navigateBackFromMaintenance, status])

    useEffect(() => {
        return subscribeToRealtimeEvents(async function (event) {
            if (event.type === 'maintenance-mode.changed') {
                queryClient.setQueryData<MaintenancePageStatus>(
                    MAINTENANCE_PAGE_STATUS_QUERY_KEY,
                    (current) => ({
                        ...(current ?? getEmptyMaintenanceStatus()),
                        isMaintenanceActive:
                            event.payload.isMaintenanceModeActive,
                        isMaintenanceScheduled:
                            event.payload.isMaintenanceModeScheduled,
                        maintenanceStartsAt: event.payload.maintenanceStartsAt,
                    }),
                )

                if (!event.payload.isMaintenanceModeActive) {
                    await navigateBackFromMaintenance()
                }
            }

            if (
                event.type === 'maintenance-extension.resolved' &&
                event.payload.userId === status?.user?.id
            ) {
                if (event.payload.status === 'approved') {
                    toast.success(t('maintenance.extensionApproved'), {
                        title: t('maintenance.title'),
                    })
                } else {
                    toast.error(t('maintenance.extensionRejected'), {
                        title: t('maintenance.title'),
                    })
                }
            }
        })
    }, [navigateBackFromMaintenance, queryClient, status?.user?.id, t])

    return {
        state: {
            status,
        },
    }
}

function getEmptyMaintenanceStatus(): MaintenancePageStatus {
    return {
        user: null,
        isMaintenanceActive: false,
        isMaintenanceScheduled: false,
        maintenanceStartsAt: null,
        canBypassMaintenance: false,
        redirectTo: '/login',
        canRequestExtension: false,
        pendingExtensionRequest: null,
    }
}
