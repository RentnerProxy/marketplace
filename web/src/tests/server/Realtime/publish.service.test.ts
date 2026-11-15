import type { BunRealtimeWebSocket } from '@/websockets/Types/bun.ts'
import { registerRealtimeConnection } from '@/websockets/Server/realtimeConnectionRegistry.ts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    publishAuditLogCreatedService,
    publishAdminBackupsChangedService,
    publishMaintenanceExtensionRequestedService,
    publishMaintenanceExtensionResolvedService,
    publishMaintenanceModeChangedService,
    publishNotificationCreatedService,
    publishPermissionManagementUpdatedService,
    publishRealtimeReauthenticationRequiredService,
    publishSessionRevokedService,
    publishSystemSettingsUpdatedService,
    publishUserAccessRevokedService,
    publishUserSessionsRevokedService,
    publishUserUpdatedService,
} from '@/server/Realtime/publish.service.ts'
import { REALTIME_PUBLISH_PATH } from '@/lib/Realtime/realtimeProtocol.ts'

const publishMocks = (function () {
    return {
        fetch: vi.fn(),
        logError: vi.fn(),
        valkeyPublish: vi.fn(async function (
            _channel: string,
            _message: string,
        ) {
            return 1
        }),
        serverPublish: vi.fn(function () {}),
    }
})()

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: publishMocks.logError }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyPublisher: function () {
            return { publish: publishMocks.valkeyPublish }
        },
    }
})

vi.mock('@/websockets/Server/realtimeServer.ts', function () {
    return {
        ensureRealtimeServer: function () {
            return { publish: publishMocks.serverPublish }
        },
    }
})

const previousEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    publishSecret: process.env.REALTIME_PUBLISH_SECRET,
    publishUrl: process.env.REALTIME_PUBLISH_URL,
    valkeyUrl: process.env.VALKEY_URL,
}
const userId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const notificationId = '33333333-3333-4333-8333-333333333333'
const auditLogId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-07-14T12:00:00.000Z'

function restoreEnvironmentValue(
    key:
        | 'NODE_ENV'
        | 'REALTIME_PUBLISH_SECRET'
        | 'REALTIME_PUBLISH_URL'
        | 'VALKEY_URL',
    value: string | undefined,
) {
    if (value === undefined) {
        delete process.env[key]
        return
    }

    process.env[key] = value
}

describe('Realtime publish service', function () {
    it('veröffentlicht einen Backup-Hinweis ausschließlich im Backup-Topic', async function () {
        process.env.VALKEY_URL = 'redis://127.0.0.1:6379'
        await publishAdminBackupsChangedService()
        const [channel, message] = publishMocks.valkeyPublish.mock.calls[0]
        expect(channel).toBe('rentnerproxy-marketplace:realtime')
        expect(JSON.parse(message)).toEqual({
            topic: 'admin-backups',
            event: {
                type: 'admin-backups.changed',
                payload: { updatedAt: expect.any(String) },
            },
        })
    })

    it('lässt einen Realtime-Ausfall keine abgeschlossene Backup-Mutation fehlschlagen', async function () {
        process.env.VALKEY_URL = 'redis://127.0.0.1:6379'
        const error = new Error('synthetic publish failure')
        publishMocks.valkeyPublish.mockRejectedValueOnce(error)
        await expect(
            publishAdminBackupsChangedService(),
        ).resolves.toBeUndefined()
        expect(publishMocks.logError).toHaveBeenCalledWith(
            'backup.realtime_publish_failed',
            error,
        )
    })

    beforeEach(function () {
        vi.clearAllMocks()
        restoreTestGlobals()
        process.env.NODE_ENV = 'test'
        delete process.env.REALTIME_PUBLISH_SECRET
        delete process.env.REALTIME_PUBLISH_URL
        delete process.env.VALKEY_URL
    })

    afterAll(function () {
        restoreTestGlobals()
        restoreEnvironmentValue('NODE_ENV', previousEnvironment.nodeEnv)
        restoreEnvironmentValue(
            'REALTIME_PUBLISH_SECRET',
            previousEnvironment.publishSecret,
        )
        restoreEnvironmentValue(
            'REALTIME_PUBLISH_URL',
            previousEnvironment.publishUrl,
        )
        restoreEnvironmentValue('VALKEY_URL', previousEnvironment.valkeyUrl)
    })

    it('veröffentlicht alle fachlichen Events mit ihren vorgesehenen Topics über Valkey', async function () {
        process.env.VALKEY_URL = 'redis://127.0.0.1:6379/15'

        await publishSystemSettingsUpdatedService({
            companyName: 'Test GmbH',
            updatedAt: timestamp,
        })
        await publishMaintenanceModeChangedService({
            isMaintenanceModeActive: true,
            isMaintenanceModeEnabled: true,
            isMaintenanceModeScheduled: false,
            maintenanceStartsAt: null,
            updatedAt: timestamp,
        })
        await publishMaintenanceExtensionResolvedService({
            requestId,
            userId,
            status: 'approved',
            maintenanceStartsAt: timestamp,
            resolvedAt: timestamp,
        })
        await publishMaintenanceExtensionRequestedService({
            request: {
                id: requestId,
                reason: 'Benötigt noch ausreichend Bearbeitungszeit.',
                requestedAt: timestamp,
                user: { id: userId, username: 'test-user' },
            },
        })
        await publishUserUpdatedService({
            userId,
            username: 'new-name',
            previousUsername: 'old-name',
            permissionKeys: ['admin.user_management'],
            previousPermissionKeys: [],
            addedPermissionKeys: ['admin.user_management'],
            removedPermissionKeys: [],
            updatedAt: timestamp,
        })
        await publishNotificationCreatedService({
            userId,
            notification: {
                id: notificationId,
                title: 'Test',
                message: 'Nachricht',
                type: 'info',
                referenceId: null,
                isRead: false,
                readAt: null,
                createdAt: timestamp,
            },
        })
        await publishUserAccessRevokedService({
            userId,
            reason: 'deactivated',
            updatedAt: timestamp,
        })
        await publishSessionRevokedService({
            userId,
            sessionHash: 'a'.repeat(64),
            revokedAt: timestamp,
        })
        await publishUserSessionsRevokedService({
            userId,
            revokedAt: timestamp,
        })
        await publishRealtimeReauthenticationRequiredService({
            reason: 'restore',
            requestedAt: timestamp,
        })
        await publishAuditLogCreatedService({
            auditLogId,
            createdAt: timestamp,
        })
        await publishPermissionManagementUpdatedService({
            scope: 'presets',
            updatedAt: timestamp,
        })

        expect(publishMocks.valkeyPublish).toHaveBeenCalledTimes(15)
        expect(publishMocks.fetch).not.toHaveBeenCalled()
        expect(publishMocks.serverPublish).not.toHaveBeenCalled()
        expect(publishMocks.valkeyPublish.mock.calls).toEqual(
            expect.arrayContaining([
                expect.arrayContaining([
                    expect.any(String),
                    expect.stringContaining('system-settings.updated'),
                ]),
                expect.arrayContaining([
                    expect.any(String),
                    expect.stringContaining('admin-user.updated'),
                ]),
                expect.arrayContaining([
                    expect.any(String),
                    expect.stringContaining('audit-log.created'),
                ]),
                expect.arrayContaining([
                    expect.any(String),
                    expect.stringContaining('admin-permissions.updated'),
                ]),
            ]),
        )
    })

    it('nutzt die lokale HTTP-Bridge ohne konfigurierte Base-URL', async function () {
        publishMocks.fetch.mockResolvedValueOnce(
            new Response(null, { status: 204 }),
        )
        stubTestGlobal('fetch', publishMocks.fetch)

        await publishAuditLogCreatedService({
            auditLogId,
            createdAt: timestamp,
        })

        expect(publishMocks.fetch).toHaveBeenCalledWith(
            `http://127.0.0.1:3001${REALTIME_PUBLISH_PATH}`,
            expect.objectContaining({ method: 'POST' }),
        )
        expect(publishMocks.serverPublish).not.toHaveBeenCalled()
    })

    it('meldet einen abgelehnten Bridge-Aufruf als Fehler', async function () {
        publishMocks.fetch.mockResolvedValueOnce(
            new Response(null, {
                status: 503,
                statusText: 'Service Unavailable',
            }),
        )
        stubTestGlobal('fetch', publishMocks.fetch)

        await expect(
            publishAuditLogCreatedService({ auditLogId, createdAt: timestamp }),
        ).rejects.toThrow(
            'Realtime publish bridge failed with 503 Service Unavailable.',
        )
    })

    it('fällt in Produktion ohne Bridge-Konfiguration auf den lokalen Server zurück', async function () {
        process.env.NODE_ENV = 'production'

        await publishUserSessionsRevokedService({
            userId,
            revokedAt: timestamp,
        })

        expect(publishMocks.serverPublish).toHaveBeenCalledTimes(1)
        expect(publishMocks.fetch).not.toHaveBeenCalled()
    })

    it('führt auch den lokalen Fallback vor Publish durch die Session-Ablaufsperre', async function () {
        process.env.NODE_ENV = 'production'
        const websocket = {
            data: {
                userId,
                username: 'synthetic-user',
                permissions: [],
                sessionHash: 'a'.repeat(64),
                expiresAt: '2000-01-01T00:00:00.000Z',
                absoluteExpiresAt: '2000-01-01T08:00:00.000Z',
                revocationEpoch: Symbol(),
            },
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
        } satisfies BunRealtimeWebSocket
        registerRealtimeConnection(websocket)
        await publishSystemSettingsUpdatedService({
            companyName: 'Synthetic company',
            updatedAt: timestamp,
        })
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(websocket.unsubscribe).toHaveBeenCalledWith('system-settings')
        expect(websocket.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
            publishMocks.serverPublish.mock.invocationCallOrder[0],
        )
        expect(publishMocks.serverPublish).toHaveBeenCalledTimes(1)
        expect(publishMocks.fetch).not.toHaveBeenCalled()
        expect(publishMocks.valkeyPublish).not.toHaveBeenCalled()
    })
})
