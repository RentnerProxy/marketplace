import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { DASHBOARD_HEALTH } from '@/config/health.config.ts'
import { getDashboardHealthHandler } from '../middleware.ts'
import type {
    DashboardServiceHealth,
    DashboardServiceId,
} from '../Types/dashboard-domain.types.ts'
import type { DashboardLogicReturn } from '../Types/dashboard-logic.types.ts'

const DASHBOARD_HEALTH_QUERY_KEY = ['admin-dashboard-health']
const serviceGroups = [
    { id: 'application', services: ['webserver', 'websocket'] },
    { id: 'processing', services: ['worker', 'core'] },
    { id: 'infrastructure', services: ['postgresql', 'valkey'] },
] as const

const checkingHealth: DashboardServiceHealth = {
    status: 'checking',
    detail: 'checking',
}
const unavailableHealth: DashboardServiceHealth = {
    status: 'unknown',
    detail: 'statusUnavailable',
}

export default function useDashboardLogic(): DashboardLogicReturn {
    const [selectedService, setSelectedService] =
        useState<DashboardServiceId | null>(null)
    const healthQuery = useQuery({
        queryKey: DASHBOARD_HEALTH_QUERY_KEY,
        queryFn: function ({ signal }) {
            return getDashboardHealthHandler({
                signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(DASHBOARD_HEALTH.requestTimeoutMs),
                ]),
            })
        },
        refetchInterval: DASHBOARD_HEALTH.refetchIntervalMs,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        staleTime: 0,
        gcTime: 0,
        retry: false,
    })

    const isUnavailable =
        healthQuery.isError || healthQuery.fetchStatus === 'paused'
    const fallbackHealth = isUnavailable ? unavailableHealth : checkingHealth
    const services = isUnavailable ? undefined : healthQuery.data?.services

    function handleSelectService(service: DashboardServiceId) {
        setSelectedService((current) => (current === service ? null : service))
    }

    function handleCloseConsole() {
        document
            .getElementById(`service-console-toggle-${selectedService}`)
            ?.focus()
        setSelectedService(null)
    }

    return {
        state: {
            groups: serviceGroups,
            selectedService,
            services: services ?? {
                webserver: fallbackHealth,
                websocket: fallbackHealth,
                worker: fallbackHealth,
                postgresql: fallbackHealth,
                valkey: fallbackHealth,
                core: fallbackHealth,
            },
        },
        handler: {
            handleSelectService,
            handleCloseConsole,
        },
    }
}
