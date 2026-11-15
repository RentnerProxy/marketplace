export type RealtimeConnectionData = {
    userId: string
    username: string
    permissions: Array<string>
    sessionHash: string
    expiresAt: string
    absoluteExpiresAt: string
    revocationEpoch: symbol
}

export type BunRealtimeWebSocket = {
    data: RealtimeConnectionData
    subscribe: (topic: string) => void
    unsubscribe: (topic: string) => void
    send: (message: string) => void
    close: (code?: number, reason?: string) => void
}

export type BunRealtimeServer = {
    publish: (topic: string, message: string) => number
    stop: (closeActiveConnections?: boolean) => Promise<void>
}

export type BunRealtimeWebSocketHandler = {
    open: (websocket: BunRealtimeWebSocket) => void
    message: (
        websocket: BunRealtimeWebSocket,
        message: string | ArrayBuffer | Uint8Array,
    ) => void
    close: (websocket: BunRealtimeWebSocket) => void
    maxPayloadLength?: number
    idleTimeout?: number
}

export type BunUpgradeServer = {
    requestIP: (request: Request) => { address: string } | null
    timeout?: (request: Request, seconds: number) => void
    upgrade: (
        request: Request,
        options: { data: RealtimeConnectionData },
    ) => boolean
}
