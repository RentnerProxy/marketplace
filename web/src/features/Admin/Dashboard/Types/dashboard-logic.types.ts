import type {
    DashboardHealthSnapshot,
    DashboardServiceId,
    DashboardServiceGroup,
} from './dashboard-domain.types.ts'

export type DashboardLogicReturn = {
    state: DashboardHealthSnapshot & {
        selectedService: DashboardServiceId | null
        groups: readonly DashboardServiceGroup[]
    }
    handler: {
        handleSelectService: (service: DashboardServiceId) => void
        handleCloseConsole: () => void
    }
}
