import type {
    DashboardServiceHealth,
    DashboardServiceId,
    DashboardServiceGroup,
    DashboardHealthSnapshot,
} from './dashboard-domain.types.ts'

export type ServiceStatusCardProps = {
    service: DashboardServiceId
    health: DashboardServiceHealth
    isSelected: boolean
    onSelect: (service: DashboardServiceId) => void
}

export type ServiceGroupProps = {
    group: DashboardServiceGroup
    health: DashboardHealthSnapshot['services']
    selectedService: DashboardServiceId | null
    onSelect: (service: DashboardServiceId) => void
}
