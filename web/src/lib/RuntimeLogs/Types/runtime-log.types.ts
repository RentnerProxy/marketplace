export type RuntimeLogServiceId =
    'webserver' | 'websocket' | 'worker' | 'postgresql' | 'valkey' | 'core'

export type RuntimeLogEntry = {
    id: string
    timestamp: string
    level: 'info' | 'warn' | 'error'
    event: string
    message?: string
    context: Record<string, string | number | boolean | null | undefined>
}

export type RuntimeLogInput = Omit<RuntimeLogEntry, 'id' | 'timestamp'> & {
    timestamp?: string
}

export type RuntimeLogSnapshot = {
    source: 'application' | 'container'
    entries: Array<RuntimeLogEntry>
    sharedHistoryAvailable: boolean
}
