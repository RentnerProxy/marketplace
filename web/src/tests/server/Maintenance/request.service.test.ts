import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@/db'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { createNotificationsService } from '@/server/Notifications/update.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { publishMaintenanceExtensionRequestedService } from '@/server/Realtime/publish.service.ts'
import { clearPendingMaintenanceExtensionRequest } from '@/server/Maintenance/requestStore.ts'
import { requestMaintenanceExtensionService } from '@/server/Maintenance/request.service.ts'

const schemaMock = (function () {
    return {
        permissions: { id: 'permissions.id', key: 'permissions.key' },
        systemSettings: { id: 'systemSettings.id' },
        staffUserPermissions: {
            permissionId: 'staffUserPermissions.permissionId',
            userId: 'staffUserPermissions.userId',
        },
        users: {
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})()

const dbMock = (function () {
    const state = {
        adminRows: [{ userId: 'admin-1' }] as Array<{ userId: string }>,
        settingsRows: [
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() + 60_000),
            },
        ] as Array<Record<string, unknown>>,
    }
    const database = {
        select: vi.fn(function (selection?: unknown) {
            const chain = {
                from: vi.fn(function () {
                    return chain
                }),
                innerJoin: vi.fn(function () {
                    return chain
                }),
                where: vi.fn(async function () {
                    return state.adminRows
                }),
                limit: vi.fn(async function () {
                    return state.settingsRows
                }),
            }
            void selection
            return chain
        }),
    }

    return { database, state }
})()

const requestStoreMocks = (function () {
    return {
        clear: vi.fn(async function () {
            return null
        }),
        get: vi.fn(async function () {
            return null as Record<string, unknown> | null
        }),
        set: vi.fn(async function () {
            return true
        }),
    }
})()

vi.mock('@/db', function () {
    return { db: dbMock.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
        ne: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'ne', left, right }
        }),
    }
})

vi.mock('@/lib/Permissions/permissions.ts', function () {
    return {
        hasPermission: vi.fn(function (
            permissionKeys: Array<string>,
            permission: string,
        ) {
            return permissionKeys.includes(permission)
        }),
    }
})

vi.mock('@/lib/Permissions/userPermissions.ts', function () {
    return {
        getUserPermissionKeys: vi.fn(async function () {
            return []
        }),
    }
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getActiveCurrentSessionUser: vi.fn(async function () {
            return { id: 'user-1', username: 'kevin' }
        }),
    }
})

vi.mock('@/server/Notifications/update.service.ts', function () {
    return {
        createNotificationsService: vi.fn(async function () {
            return []
        }),
    }
})

vi.mock('@/server/Realtime/publish.service.ts', function () {
    return {
        publishMaintenanceModeChangedService: vi.fn(async function () {}),
        publishMaintenanceExtensionRequestedService: vi.fn(
            async function () {},
        ),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

vi.mock('@/server/Maintenance/requestStore.ts', function () {
    return {
        clearPendingMaintenanceExtensionRequest: requestStoreMocks.clear,
        getPendingMaintenanceExtensionRequest: requestStoreMocks.get,
        setPendingMaintenanceExtensionRequest: requestStoreMocks.set,
    }
})

const mockedGetActiveCurrentSessionUser = getActiveCurrentSessionUser as Mock<
    typeof getActiveCurrentSessionUser
>
const mockedGetUserPermissionKeys = getUserPermissionKeys as Mock<
    typeof getUserPermissionKeys
>
const mockedCreateNotificationsService = createNotificationsService as Mock<
    typeof createNotificationsService
>
const mockedPublishMaintenanceExtensionRequested =
    publishMaintenanceExtensionRequestedService as Mock<
        typeof publishMaintenanceExtensionRequestedService
    >

describe('requestMaintenanceExtensionService', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        mockedGetActiveCurrentSessionUser.mockResolvedValue({
            id: 'user-1',
            username: 'kevin',
        } as never)
        mockedGetUserPermissionKeys.mockResolvedValue([])
        dbMock.state.settingsRows = [
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() + 60_000),
            },
        ]
        dbMock.state.adminRows = [{ userId: 'admin-1' }, { userId: 'admin-2' }]
        requestStoreMocks.get.mockResolvedValue(null)
        requestStoreMocks.set.mockResolvedValue(true)
    })

    it('weist Requests ohne aktive Sitzung zurück', async function () {
        mockedGetActiveCurrentSessionUser.mockResolvedValueOnce(null)

        await expect(
            requestMaintenanceExtensionService({ reason: 'Mehr Zeit' }),
        ).resolves.toEqual({
            success: false,
            error: 'Deine Sitzung ist nicht mehr gültig.',
        })
        expect(getUserPermissionKeys).not.toHaveBeenCalled()
    })

    it('weist Benutzer mit bestehender Bypass-Berechtigung zurück', async function () {
        mockedGetUserPermissionKeys.mockResolvedValueOnce([
            'admin.maintenanceBypass',
        ])

        await expect(
            requestMaintenanceExtensionService({ reason: 'Mehr Zeit' }),
        ).resolves.toEqual({
            success: false,
            error: 'Du darfst den Wartungsmodus bereits umgehen.',
        })
    })

    it.each([
        [{}],
        [{ isMaintenanceModeEnabled: false, maintenanceStartsAt: null }],
        [
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() - 60_000),
            },
        ],
    ])(
        'weist einen nicht geplanten Wartungsmodus zurück',
        async function (settings) {
            dbMock.state.settingsRows = [settings]

            const result = await requestMaintenanceExtensionService({
                reason: 'Mehr Zeit',
            })

            expect(result).toEqual({
                success: false,
                error: 'Der Wartungsmodus ist nicht geplant.',
            })
        },
    )

    it('verhindert parallele offene Requests vor und beim Speichern', async function () {
        requestStoreMocks.get.mockResolvedValueOnce({ id: 'existing' })

        await expect(
            requestMaintenanceExtensionService({ reason: 'Mehr Zeit' }),
        ).resolves.toMatchObject({ success: false })
        expect(requestStoreMocks.set).not.toHaveBeenCalled()

        requestStoreMocks.get.mockResolvedValueOnce(null)
        requestStoreMocks.set.mockResolvedValueOnce(false)
        await expect(
            requestMaintenanceExtensionService({ reason: 'Mehr Zeit' }),
        ).resolves.toMatchObject({ success: false })
    })

    it('räumt den Request auf, wenn Admin-Benachrichtigungen scheitern', async function () {
        const error = new Error('Notification-DB offline')
        mockedCreateNotificationsService.mockRejectedValueOnce(error)

        await expect(
            requestMaintenanceExtensionService({ reason: 'Mehr Zeit' }),
        ).rejects.toBe(error)
        expect(clearPendingMaintenanceExtensionRequest).toHaveBeenCalledWith(
            expect.any(String),
        )
        expect(
            publishMaintenanceExtensionRequestedService,
        ).not.toHaveBeenCalled()
    })

    it('benachrichtigt alle anderen Admins und publiziert den Request', async function () {
        const result = await requestMaintenanceExtensionService({
            reason: 'Deployment abschließen',
        })

        expect(db.select).toHaveBeenCalledTimes(2)
        expect(createNotificationsService).toHaveBeenCalledWith([
            expect.objectContaining({
                userId: 'admin-1',
                title: 'Neuer Wartungsantrag',
                type: 'maintenance-extension-requested',
            }),
            expect.objectContaining({ userId: 'admin-2' }),
        ])
        expect(
            publishMaintenanceExtensionRequestedService,
        ).toHaveBeenCalledWith({
            request: result.request,
        })
        expect(result).toMatchObject({
            success: true,
            request: {
                reason: 'Deployment abschließen',
                user: { id: 'user-1', username: 'kevin' },
            },
        })
        expect(result.request?.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
    })

    it('liefert den gespeicherten Request trotz Realtime-Ausfall zurück', async function () {
        const error = new Error('WebSocket offline')
        mockedPublishMaintenanceExtensionRequested.mockRejectedValueOnce(error)

        const result = await requestMaintenanceExtensionService({
            reason: 'Mehr Zeit',
        })

        expect(result.success).toBe(true)
        expect(logError).toHaveBeenCalledWith(
            'maintenance.request.realtime_publish_failed',
            error,
            { requestId: result.request?.id },
        )
    })
})
