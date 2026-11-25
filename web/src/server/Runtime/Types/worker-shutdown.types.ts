export type WorkerShutdownOptions = {
    ready: Promise<void>
    stopHeartbeat: () => Promise<void>
    closeWorkers: () => Promise<void>
    stopStatus: () => Promise<void>
    closeConnections: () => Promise<void>
}
