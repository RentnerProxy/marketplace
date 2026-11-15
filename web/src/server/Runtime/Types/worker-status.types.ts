export type WorkerRuntimeStatus = 'starting' | 'running' | 'error'

export type WorkerRuntimeHealth =
    | { status: WorkerRuntimeStatus; reason: 'heartbeat' }
    | { status: 'down'; reason: 'missing' | 'expired' }
    | { status: 'error'; reason: 'invalid' }

export type WorkerStatusReporter = {
    reportStatus: (status: WorkerRuntimeStatus) => Promise<void>
    stop: () => Promise<void>
}
