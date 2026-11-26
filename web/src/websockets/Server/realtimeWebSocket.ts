import { isRestoreStateActiveService } from '@/server/Admin/Backups/restore-state.service.ts'
import { REALTIME_WS_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import type {
    BunRealtimeWebSocketHandler,
    BunUpgradeServer,
} from '@/websockets/Types/bun.ts'
import {
    registerRealtimeConnection,
    unregisterRealtimeConnection,
} from './realtimeConnectionRegistry.ts'
import {
    clearRealtimeValidation,
    isRealtimeSessionActive,
    getRealtimeConnectionData,
    startRealtimeValidation,
} from './realtimeSessionValidation.ts'

function hasValidRealtimeOrigin(request: Request) {
    const expectedOrigin = process.env.ORIGIN?.trim()

    if (!expectedOrigin) {
        return process.env.NODE_ENV !== 'production'
    }

    return request.headers.get('origin') === expectedOrigin
}

export async function handleRealtimeUpgrade(
    request: Request,
    upgradeServer: BunUpgradeServer,
) {
    const url = new URL(request.url)

    if (url.pathname !== REALTIME_WS_PATH) {
        return new Response('Not found', { status: 404 })
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', {
            status: 426,
        })
    }

    if (!hasValidRealtimeOrigin(request)) {
        return new Response('Forbidden', { status: 403 })
    }

    if (await isRestoreStateActiveService()) {
        return new Response('Restore in progress', {
            status: 503,
            headers: {
                'cache-control': 'no-store',
                'retry-after': '3',
            },
        })
    }

    const connectionData = await getRealtimeConnectionData(request)

    if (!connectionData) {
        return new Response('Unauthorized', { status: 401 })
    }

    const upgraded = upgradeServer.upgrade(request, {
        data: connectionData,
    })

    if (upgraded) {
        return undefined
    }

    return new Response('WebSocket upgrade failed', { status: 400 })
}

export const realtimeWebSocketHandler = {
    open(websocket) {
        if (!registerRealtimeConnection(websocket)) {
            websocket.close(4008, 'Zu viele parallele Verbindungen.')
            return
        }

        startRealtimeValidation(websocket)
    },
    message(websocket, message) {
        if (!isRealtimeSessionActive(websocket)) return
        if (message === 'ping') {
            websocket.send('pong')
            return
        }

        websocket.close(1008, 'Nicht unterstützte Nachricht.')
    },
    close(websocket) {
        clearRealtimeValidation(websocket)
        unregisterRealtimeConnection(websocket)
    },
    maxPayloadLength: 64,
    idleTimeout: 120,
} satisfies BunRealtimeWebSocketHandler
