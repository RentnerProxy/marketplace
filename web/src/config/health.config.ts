export const DASHBOARD_HEALTH = {
    refetchIntervalMs: 10000,
    requestTimeoutMs: 8000,
    checkTimeoutMs: 3000,
    logIntervalMs: 60000,
} as const

export const APP_READINESS = {
    cacheMs: 2000,
    requestTimeoutMs: 3000,
} as const

export const WORKER_HEALTH = {
    intervalMs: 10000,
    maxAgeMs: 30000,
    statusKey: 'rentnerproxy-marketplace:runtime:worker-status',
} as const

export const WORKER_SHUTDOWN = {
    cleanupTimeoutMs: 10000,
    progressIntervalMs: 10000,
} as const
