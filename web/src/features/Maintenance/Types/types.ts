export type MaintenancePageStatus = {
    user: {
        id: string
        username: string
        email: string
    } | null
    isMaintenanceActive: boolean
    isMaintenanceScheduled: boolean
    maintenanceStartsAt: string | null
    canBypassMaintenance: boolean
    redirectTo: string
    canRequestExtension: boolean
    pendingExtensionRequest: {
        id: string
        userId: string
        username: string
        reason: string
        requestedAt: string
        user: {
            id: string
            username: string
        }
    } | null
}

type MaintenanceState = {
    status?: MaintenancePageStatus
}

export type MaintenanceStatusCardProps = {
    status?: MaintenancePageStatus
}

export type MaintenanceLogicReturn = {
    state: MaintenanceState
}
