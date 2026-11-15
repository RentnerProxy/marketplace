import type { RealtimeEventListener } from '@/websockets/Types/realtime-client.types.ts'
import { parseRealtimeEvent } from '@/lib/Realtime/realtimeEventGuard.ts'
import { REALTIME_WS_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'

const HEARTBEAT_INTERVAL_MS = 45000
const MAX_RECONNECT_DELAY_MS = 30000
const MIN_RECONNECT_DELAY_MS = 1000

const listeners = new Set<RealtimeEventListener>()

let websocket: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let shouldReconnect = false
let isConnecting = false
let isPageSuspended = false
let arePageLifecycleListenersRegistered = false

function getRealtimeUrl() {
    const configuredUrl = import.meta.env.VITE_REALTIME_WS_URL

    if (configuredUrl) {
        return configuredUrl
    }

    const url = new URL(window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

    if (import.meta.env.DEV) {
        url.port = import.meta.env.VITE_REALTIME_WS_DEV_PORT ?? '3001'
    }

    url.pathname = REALTIME_WS_PATH
    url.search = ''
    url.hash = ''

    return url.toString()
}

function clearReconnectTimeout() {
    if (!reconnectTimeout) {
        return
    }

    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
}

function clearHeartbeatInterval() {
    if (!heartbeatInterval) {
        return
    }

    clearInterval(heartbeatInterval)
    heartbeatInterval = null
}

function startHeartbeat(currentWebsocket: WebSocket) {
    clearHeartbeatInterval()
    heartbeatInterval = setInterval(function () {
        if (currentWebsocket.readyState === WebSocket.OPEN) {
            currentWebsocket.send('ping')
        }
    }, HEARTBEAT_INTERVAL_MS)
}

function scheduleReconnect() {
    if (!shouldReconnect || listeners.size === 0 || isPageSuspended) {
        return
    }

    clearReconnectTimeout()
    const exponentialDelay = Math.min(
        MIN_RECONNECT_DELAY_MS * 2 ** Math.min(reconnectAttempts, 5),
        MAX_RECONNECT_DELAY_MS,
    )
    const jitter = Math.floor(
        Math.random() * Math.min(exponentialDelay * 0.25, 1000),
    )
    reconnectAttempts += 1
    reconnectTimeout = setTimeout(function () {
        connect()
    }, exponentialDelay + jitter)
}

function dispatchRealtimeEvent(event: RealtimeEvent) {
    for (const listener of listeners) {
        try {
            void Promise.resolve(listener(event)).catch((error: unknown) => {
                console.error('Realtime event listener failed', error)
            })
        } catch (error: unknown) {
            console.error('Realtime event listener failed', error)
        }
    }
}

function closeCurrentWebSocket() {
    clearReconnectTimeout()
    clearHeartbeatInterval()

    const currentWebsocket = websocket
    websocket = null

    if (currentWebsocket && currentWebsocket.readyState !== WebSocket.CLOSED) {
        currentWebsocket.close()
    }
}

function setupPageLifecycleListeners() {
    if (arePageLifecycleListenersRegistered || typeof window === 'undefined') {
        return
    }

    arePageLifecycleListenersRegistered = true

    window.addEventListener('pagehide', function () {
        isPageSuspended = true
        closeCurrentWebSocket()
    })

    window.addEventListener('pageshow', function () {
        isPageSuspended = false

        if (shouldReconnect && listeners.size > 0) {
            connect()
        }
    })
}

function connect() {
    if (isConnecting || websocket || listeners.size === 0 || isPageSuspended) {
        return
    }

    isConnecting = true

    try {
        if (!shouldReconnect || listeners.size === 0) {
            return
        }

        const socket = new WebSocket(getRealtimeUrl())
        websocket = socket

        socket.addEventListener('open', function () {
            reconnectAttempts = 0
            startHeartbeat(socket)
        })

        socket.addEventListener('message', function (event) {
            if (typeof event.data !== 'string') {
                return
            }

            if (event.data === 'pong') {
                return
            }

            const realtimeEvent = parseRealtimeEvent(event.data)

            if (!realtimeEvent) {
                return
            }

            dispatchRealtimeEvent(realtimeEvent)
        })

        socket.addEventListener('error', function () {
            socket.close()
        })

        socket.addEventListener('close', function () {
            clearHeartbeatInterval()

            if (websocket === socket) {
                websocket = null
            }

            scheduleReconnect()
        })
    } catch {
        scheduleReconnect()
    } finally {
        isConnecting = false
    }
}

export function subscribeToRealtimeEvents(listener: RealtimeEventListener) {
    setupPageLifecycleListeners()

    listeners.add(listener)
    shouldReconnect = true
    reconnectAttempts = 0
    clearReconnectTimeout()
    connect()

    return function unsubscribeFromRealtimeEvents() {
        listeners.delete(listener)

        if (listeners.size > 0) {
            return
        }

        shouldReconnect = false
        closeCurrentWebSocket()
    }
}

export function reconnectRealtimeEvents() {
    if (isPageSuspended) {
        return
    }

    if (websocket) {
        websocket.close()
        return
    }

    connect()
}
