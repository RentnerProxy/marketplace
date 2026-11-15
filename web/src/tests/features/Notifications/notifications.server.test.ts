import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'

const events: Array<string> = []
const userId = 'session-owner'
const notificationId = '0197f495-622c-70ad-9fd4-11edce58c001'
const notification = {
    id: notificationId,
    title: 'Synthetic notification',
    message: 'Synthetic message',
    type: 'test',
    referenceId: null,
    isRead: false,
    readAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
}
const access = { sessionUser: { id: userId }, permissionKeys: [] }
const mocks = {
    requireAccess: vi.fn(async function () {
        return access
    }),
    getNotifications: vi.fn(async function (..._args: Array<unknown>) {
        events.push('read')
        return [notification]
    }),
    markRead: vi.fn(async function (..._args: Array<unknown>) {
        events.push('mark-one')
    }),
    markAllRead: vi.fn(async function (..._args: Array<unknown>) {
        events.push('mark-all')
    }),
}

vi.mock('@tanstack/react-start', function () {
    return {
        createServerFn: function () {
            return {
                handler: function (operation: () => Promise<unknown>) {
                    return operation
                },
                validator: function (validate: (input: unknown) => unknown) {
                    return {
                        handler: function (
                            operation: (context: {
                                data: unknown
                            }) => Promise<unknown>,
                        ) {
                            return async function (input: { data: unknown }) {
                                return operation({ data: validate(input.data) })
                            }
                        },
                    }
                },
            }
        },
    }
})
vi.mock('@/server/Auth/authorization.service.ts', function () {
    return { requireAuthenticatedFeatureAccessService: mocks.requireAccess }
})
vi.mock('@/server/Notifications/get.service.ts', function () {
    return { getNotificationsService: mocks.getNotifications }
})
vi.mock('@/server/Notifications/update.service.ts', function () {
    return {
        markNotificationAsReadService: mocks.markRead,
        markAllNotificationsAsReadService: mocks.markAllRead,
    }
})

const handlers = await import('@/features/Notifications/middleware.ts')
const markInput = { notificationId, userId: 'untrusted-client-owner' }
const operations = [
    {
        name: 'getNotificationsHandler',
        invoke: () => handlers.getNotificationsHandler(),
        service: mocks.getNotifications,
        args: [userId],
        expected: [notification],
    },
    {
        name: 'markNotificationAsReadHandler',
        invoke: () =>
            handlers.markNotificationAsReadHandler({ data: markInput }),
        service: mocks.markRead,
        args: [userId, notificationId],
        expected: { success: true as const },
    },
    {
        name: 'markAllNotificationsAsReadHandler',
        invoke: () => handlers.markAllNotificationsAsReadHandler(),
        service: mocks.markAllRead,
        args: [userId],
        expected: { success: true as const },
    },
]

function expectNoDomainCalls() {
    expect(mocks.getNotifications).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()
    expect(mocks.markAllRead).not.toHaveBeenCalled()
}

describe('Notifications: serverseitige Wartungsgrenze', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        events.length = 0
        mocks.requireAccess.mockImplementation(async function () {
            events.push('access')
            return access
        })
    })

    it('prüft alle exportierten Benachrichtigungsoperationen', function () {
        expect(Object.keys(handlers).toSorted()).toEqual(
            operations.map((operation) => operation.name).toSorted(),
        )
        expect(operations).toHaveLength(3)
    })

    it.each(operations)(
        'blockiert $name vor der Domänenoperation',
        async function (operation) {
            const error = new MaintenanceModeError()
            mocks.requireAccess.mockRejectedValue(error)

            await expect(operation.invoke()).rejects.toBe(error)

            expect(mocks.requireAccess).toHaveBeenCalledTimes(1)
            expectNoDomainCalls()
        },
    )

    it.each(operations)(
        'führt $name nur für den geprüften Sessionbesitzer aus',
        async function (operation) {
            await expect(operation.invoke()).resolves.toEqual(
                operation.expected,
            )

            expect(events[0]).toBe('access')
            expect(mocks.requireAccess).toHaveBeenCalledTimes(1)
            expect(operation.service).toHaveBeenCalledTimes(1)
            expect(operation.service).toHaveBeenCalledWith(...operation.args)
        },
    )

    it.each([
        { error: new AuthenticationRequiredError() },
        { error: new Error('synthetic policy storage unavailable') },
    ])(
        'lehnt fehlende Authentifizierung und Zugriffsfehler geschlossen ab',
        async function ({ error }) {
            mocks.requireAccess.mockRejectedValue(error)

            await expect(
                handlers.markAllNotificationsAsReadHandler(),
            ).rejects.toBe(error)

            expectNoDomainCalls()
        },
    )
})
