import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    handleRealtimePublishBridge,
    setRealtimeServer,
} from '@/websockets/Server/realtimeServer.ts'
import { dispatchRealtimeEvent } from '@/websockets/Server/realtimeConnectionRegistry.ts'
import {
    handleRealtimeUpgrade,
    realtimeWebSocketHandler,
} from '@/websockets/Server/realtimeWebSocket.ts'
import type {
    BunRealtimeServer,
    BunRealtimeWebSocket,
    BunUpgradeServer,
} from '@/websockets/Types/bun.ts'
import { getRealtimeRevocationEpoch } from '@/websockets/Server/realtimeSessionValidation.ts'
import {
    ADMIN_STAFF_TOPIC,
    ADMIN_USERS_TOPIC,
} from '@/lib/Realtime/realtimeProtocol.ts'
import * as maintenanceState from '@/server/Maintenance/state.service.ts'

const restoreStateMocks = (function () {
    return {
        isActive: vi.fn(async function () {
            return false
        }),
    }
})()

vi.mock('@/db', function () {
    return { db: {} }
})

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { isRestoreStateActiveService: restoreStateMocks.isActive }
})

const previousOrigin = process.env.ORIGIN

function createUpgradeServer() {
    return {
        requestIP: vi.fn(function () {
            return { address: '127.0.0.1' }
        }),
        upgrade: vi.fn(function () {
            return true
        }),
    } satisfies BunUpgradeServer
}

function createWebSocket(
    userId = '11111111-1111-4111-8111-111111111111',
    permissions: Array<string> = [],
) {
    return {
        data: {
            userId,
            username: 'kevin',
            permissions,
            sessionHash: 'a'.repeat(64),
            revocationEpoch: getRealtimeRevocationEpoch(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            absoluteExpiresAt: new Date(
                Date.now() + 8 * 60 * 60_000,
            ).toISOString(),
        },
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
    } satisfies BunRealtimeWebSocket
}

describe('Realtime-Server-Sicherheit', function () {
    beforeEach(function () {
        process.env.ORIGIN = 'https://app.example.test'
        restoreStateMocks.isActive.mockResolvedValue(false)
    })

    afterEach(function () {
        vi.restoreAllMocks()
        delete globalThis.appRealtimeServer
        if (previousOrigin === undefined) {
            delete process.env.ORIGIN
        } else {
            process.env.ORIGIN = previousOrigin
        }
    })

    it('lehnt WebSocket-Upgrades von einer fremden Origin vor der Sessionprüfung ab', async function () {
        const upgradeServer = createUpgradeServer()
        const response = await handleRealtimeUpgrade(
            new Request('https://app.example.test/ws', {
                headers: {
                    origin: 'https://evil.example.test',
                    upgrade: 'websocket',
                },
            }),
            upgradeServer,
        )

        expect(response?.status).toBe(403)
        expect(upgradeServer.upgrade).not.toHaveBeenCalled()
    })

    it('behandelt ein fehlerhaft kodiertes Session-Cookie als nicht autorisiert', async function () {
        const response = await handleRealtimeUpgrade(
            new Request('https://app.example.test/ws', {
                headers: {
                    cookie: 'session_id=%E0%A4%A',
                    origin: 'https://app.example.test',
                    upgrade: 'websocket',
                },
            }),
            createUpgradeServer(),
        )

        expect(response?.status).toBe(401)
    })

    it('lehnt neue WebSocket-Verbindungen während eines Restores ab', async function () {
        restoreStateMocks.isActive.mockResolvedValue(true)
        const upgradeServer = createUpgradeServer()
        const response = await handleRealtimeUpgrade(
            new Request('https://app.example.test/ws', {
                headers: {
                    cookie: 'session_id=session-token',
                    origin: 'https://app.example.test',
                    upgrade: 'websocket',
                },
            }),
            upgradeServer,
        )

        expect(response?.status).toBe(503)
        expect(response?.headers.get('retry-after')).toBe('3')
        expect(upgradeServer.upgrade).not.toHaveBeenCalled()
    })

    it('behält Methode, Secret und Envelope der Publish-Bridge bei', async function () {
        const server = {
            publish: vi.fn(function () {
                return 1
            }),
            stop: vi.fn(async function () {}),
        } satisfies BunRealtimeServer
        setRealtimeServer(server)

        const methodResponse = await handleRealtimePublishBridge(
            new Request('https://app.example.test/__internal/realtime/publish'),
            'secret',
        )
        expect(methodResponse.status).toBe(405)

        const secretResponse = await handleRealtimePublishBridge(
            new Request(
                'https://app.example.test/__internal/realtime/publish',
                {
                    method: 'POST',
                    headers: { 'x-realtime-publish-secret': 'wrong' },
                },
            ),
            'secret',
        )
        expect(secretResponse.status).toBe(404)

        const invalidResponse = await handleRealtimePublishBridge(
            new Request(
                'https://app.example.test/__internal/realtime/publish',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-realtime-publish-secret': 'secret',
                    },
                    body: JSON.stringify({
                        topic: 'admin-audit-logs',
                        event: {},
                    }),
                },
            ),
            'secret',
        )
        expect(invalidResponse.status).toBe(400)

        const event = {
            type: 'audit-log.created' as const,
            payload: {
                auditLogId: '01941f29-7c00-7000-8000-000000000006',
                createdAt: '2026-07-14T18:00:00.000Z',
            },
        }
        const successResponse = await handleRealtimePublishBridge(
            new Request(
                'https://app.example.test/__internal/realtime/publish',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-realtime-publish-secret': 'secret',
                    },
                    body: JSON.stringify({
                        topic: 'admin-audit-logs',
                        event,
                    }),
                },
            ),
            'secret',
        )

        expect(successResponse.status).toBe(200)
        expect(server.publish).toHaveBeenCalledWith(
            'admin-audit-logs',
            JSON.stringify(event),
        )
    })

    it('invalidates the local maintenance cache before publishing state changes', function () {
        const invalidate = vi.spyOn(
            maintenanceState,
            'invalidateMaintenanceStateService',
        )
        const publish = vi.fn(function () {
            expect(invalidate).toHaveBeenCalledTimes(publish.mock.calls.length)
            return 0
        })
        const server = { publish, async stop() {} }
        const timestamp = new Date().toISOString()
        dispatchRealtimeEvent(server, 'system-settings', {
            type: 'system-settings.updated',
            payload: { companyName: 'Synthetic company', updatedAt: timestamp },
        })
        dispatchRealtimeEvent(server, 'maintenance-mode', {
            type: 'maintenance-mode.changed',
            payload: {
                isMaintenanceModeEnabled: false,
                isMaintenanceModeActive: false,
                isMaintenanceModeScheduled: false,
                maintenanceStartsAt: null,
                updatedAt: timestamp,
            },
        })
        dispatchRealtimeEvent(server, 'system-settings', {
            type: 'system-restore.changed',
            payload: {
                version: 1,
                status: 'completed',
                phase: 'finalizing',
                percent: 100,
                processedBytes: 1,
                totalBytes: 1,
                startedAt: timestamp,
                updatedAt: timestamp,
            },
        })
        expect(publish).toHaveBeenCalledTimes(3)
    })

    it('schließt nur die WebSockets der widerrufenen Sitzung', function () {
        const websocket = createWebSocket()
        realtimeWebSocketHandler.open(websocket)
        const server = {
            publish: vi.fn(function () {
                return 1
            }),
            stop: vi.fn(async function () {}),
        } satisfies BunRealtimeServer

        dispatchRealtimeEvent(server, 'user:test', {
            type: 'session.revoked',
            payload: {
                userId: websocket.data.userId,
                sessionHash: websocket.data.sessionHash,
                revokedAt: new Date().toISOString(),
            },
        })

        expect(websocket.close).toHaveBeenCalledWith(
            4001,
            'Die Sitzung wurde beendet.',
        )
        realtimeWebSocketHandler.close(websocket)
    })

    it('begrenzt parallele WebSockets pro Benutzer', function () {
        const websockets = Array.from({ length: 11 }, function () {
            return createWebSocket()
        })

        for (const websocket of websockets) {
            realtimeWebSocketHandler.open(websocket)
        }

        expect(websockets.at(-1)?.close).toHaveBeenCalledWith(
            4008,
            'Zu viele parallele Verbindungen.',
        )

        for (const websocket of websockets) {
            realtimeWebSocketHandler.close(websocket)
        }
    })

    it('subscribes a superuser to the staff topic', function () {
        const websocket = createWebSocket(undefined, [
            PERMISSIONS.ADMIN_SUPER_USER,
        ])

        realtimeWebSocketHandler.open(websocket)

        expect(websocket.subscribe).toHaveBeenCalledWith(ADMIN_STAFF_TOPIC)
        expect(websocket.subscribe).not.toHaveBeenCalledWith(ADMIN_USERS_TOPIC)
        realtimeWebSocketHandler.close(websocket)
    })

    it('erzwingt nach einem Restore eine Reauthentifizierung aller Verbindungen', function () {
        const first = createWebSocket()
        const second = createWebSocket('22222222-2222-4222-8222-222222222222')
        realtimeWebSocketHandler.open(first)
        realtimeWebSocketHandler.open(second)
        const server = {
            publish: vi.fn(function () {
                return 2
            }),
            stop: vi.fn(async function () {}),
        } satisfies BunRealtimeServer

        dispatchRealtimeEvent(server, 'system-settings', {
            type: 'realtime.reauthentication-required',
            payload: {
                reason: 'restore',
                requestedAt: new Date().toISOString(),
            },
        })

        expect(first.close).toHaveBeenCalled()
        expect(second.close).toHaveBeenCalled()
        realtimeWebSocketHandler.close(first)
        realtimeWebSocketHandler.close(second)
    })

    it('entzieht abgelaufenen Verbindungen vor einem nativen Publish sämtliche Topics', function () {
        const websocket = createWebSocket()
        const topics = new Set<string>()
        const observations: Array<Array<string>> = []
        websocket.subscribe.mockImplementation(function (topic: string) {
            topics.add(topic)
        })
        websocket.unsubscribe.mockImplementation(function (topic: string) {
            topics.delete(topic)
        })
        realtimeWebSocketHandler.open(websocket)
        const server = {
            publish: vi.fn(function () {
                observations.push([...topics])
                return 1
            }),
            stop: vi.fn(async function () {}),
        } satisfies BunRealtimeServer
        vi.spyOn(Date, 'now').mockReturnValue(
            Date.parse(websocket.data.expiresAt),
        )
        dispatchRealtimeEvent(server, 'system-settings', {
            type: 'user.sessions-revoked',
            payload: {
                userId: 'another-user',
                revokedAt: new Date().toISOString(),
            },
        })
        expect(observations).toEqual([[]])
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(websocket.unsubscribe).toHaveBeenCalledWith('system-settings')
        realtimeWebSocketHandler.close(websocket)
    })

    it('beantwortet nach der bestätigten Frist auch vor dem Timerlauf keinen Ping', function () {
        const websocket = createWebSocket()
        realtimeWebSocketHandler.open(websocket)
        websocket.send.mockClear()
        vi.spyOn(Date, 'now').mockReturnValue(
            Date.parse(websocket.data.expiresAt),
        )
        realtimeWebSocketHandler.message(websocket, 'ping')
        expect(websocket.send).not.toHaveBeenCalled()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(websocket.unsubscribe).toHaveBeenCalled()
        realtimeWebSocketHandler.close(websocket)
    })
})
