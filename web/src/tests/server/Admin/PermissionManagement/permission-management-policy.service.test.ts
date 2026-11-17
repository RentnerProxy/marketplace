import {
    haveSamePermissionKeys,
    normalizePermissionKeys,
} from '@/lib/Permissions/permissionCollections.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    AUTOMATIC_SUPER_USER_PERMISSION_ERROR,
    hasSuperUserMutationAccessInTransaction,
    resolvePermissionSelectionInTransaction,
    UNKNOWN_PERMISSION_ERROR,
} from '@/server/Admin/PermissionManagement/permission-management-policy.service.ts'

const serviceMocks = (function () {
    return {
        getActiveUserPermissionKeysInTransaction: vi.fn(),
        loadSelectedPermissionsInTransaction: vi.fn(),
        lockAndCountActiveSuperUsers: vi.fn(),
        lockAuditUsersInTransactionService: vi.fn(async function () {}),
    }
})()

vi.mock('@/lib/AuditLogs/user-locks.ts', function () {
    return {
        lockAuditUsersInTransactionService:
            serviceMocks.lockAuditUsersInTransactionService,
    }
})

vi.mock('@/db', function () {
    return { db: { select: vi.fn() } }
})

vi.mock('@/db/schema.ts', function () {
    return {
        permissions: { id: 'permissions.id', key: 'permissions.key' },
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
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
    }
})

vi.mock('@/server/Auth/transaction-authorization.service.ts', function () {
    return {
        getActiveUserPermissionKeysInTransaction:
            serviceMocks.getActiveUserPermissionKeysInTransaction,
    }
})

vi.mock(
    '@/server/Admin/UserManagement/permissionContext.service.ts',
    function () {
        return {
            lockAndCountActiveSuperUsers:
                serviceMocks.lockAndCountActiveSuperUsers,
        }
    },
)

vi.mock(
    '@/server/Admin/UserManagement/updatePersistence.service.ts',
    function () {
        return {
            loadSelectedPermissionsInTransaction:
                serviceMocks.loadSelectedPermissionsInTransaction,
        }
    },
)

describe('PermissionManagement Policy', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        serviceMocks.lockAndCountActiveSuperUsers.mockResolvedValue(1)
    })

    it('normalisiert Permission-Keys und vergleicht Mengen unabhängig von ihrer Reihenfolge', function () {
        expect(
            normalizePermissionKeys([
                PERMISSIONS.ADMIN_DASHBOARD,
                PERMISSIONS.USER_DASHBOARD,
                PERMISSIONS.ADMIN_DASHBOARD,
            ]),
        ).toEqual([PERMISSIONS.ADMIN_DASHBOARD, PERMISSIONS.USER_DASHBOARD])
        expect(
            haveSamePermissionKeys(
                [PERMISSIONS.ADMIN_DASHBOARD, PERMISSIONS.USER_DASHBOARD],
                [PERMISSIONS.USER_DASHBOARD, PERMISSIONS.ADMIN_DASHBOARD],
            ),
        ).toBe(true)
        expect(
            haveSamePermissionKeys(
                [PERMISSIONS.ADMIN_DASHBOARD],
                [PERMISSIONS.USER_DASHBOARD],
            ),
        ).toBe(false)
    })

    it('löst bekannte Permissions in der normalisierten Eingabereihenfolge auf', async function () {
        const transaction = { id: 'transaction' }
        serviceMocks.loadSelectedPermissionsInTransaction.mockResolvedValueOnce(
            [
                { id: 'permission-user', key: PERMISSIONS.USER_DASHBOARD },
                {
                    id: 'permission-admin',
                    key: PERMISSIONS.ADMIN_DASHBOARD,
                },
            ],
        )

        const result = await resolvePermissionSelectionInTransaction(
            transaction as never,
            [
                PERMISSIONS.ADMIN_DASHBOARD,
                PERMISSIONS.USER_DASHBOARD,
                PERMISSIONS.ADMIN_DASHBOARD,
            ],
            { allowSuperUser: false },
        )

        expect(
            serviceMocks.loadSelectedPermissionsInTransaction,
        ).toHaveBeenCalledWith(transaction, [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.USER_DASHBOARD,
        ])
        expect(result).toEqual({
            success: true,
            permissionKeys: [
                PERMISSIONS.ADMIN_DASHBOARD,
                PERMISSIONS.USER_DASHBOARD,
            ],
            permissions: [
                {
                    id: 'permission-admin',
                    key: PERMISSIONS.ADMIN_DASHBOARD,
                },
                { id: 'permission-user', key: PERMISSIONS.USER_DASHBOARD },
            ],
        })
    })

    it('lehnt nicht konfigurierte Permission-Keys vor dem Datenbankzugriff ab', async function () {
        const result = await resolvePermissionSelectionInTransaction(
            {} as never,
            ['admin.unbekannt'],
            { allowSuperUser: false },
        )

        expect(result).toEqual({
            success: false,
            error: UNKNOWN_PERMISSION_ERROR,
        })
        expect(
            serviceMocks.loadSelectedPermissionsInTransaction,
        ).not.toHaveBeenCalled()
    })

    it('lehnt konfigurierte, aber in der Datenbank fehlende Permissions ab', async function () {
        serviceMocks.loadSelectedPermissionsInTransaction.mockResolvedValueOnce(
            [{ id: 'permission-admin', key: PERMISSIONS.ADMIN_DASHBOARD }],
        )

        const result = await resolvePermissionSelectionInTransaction(
            {} as never,
            [PERMISSIONS.ADMIN_DASHBOARD, PERMISSIONS.USER_DASHBOARD],
            { allowSuperUser: false },
        )

        expect(result).toEqual({
            success: false,
            error: UNKNOWN_PERMISSION_ERROR,
        })
    })

    it('verbietet automatische Superuser-Rechte und erlaubt die individuelle Auswahl', async function () {
        const forbiddenResult = await resolvePermissionSelectionInTransaction(
            {} as never,
            [PERMISSIONS.ADMIN_SUPER_USER],
            { allowSuperUser: false },
        )

        expect(forbiddenResult).toEqual({
            success: false,
            error: AUTOMATIC_SUPER_USER_PERMISSION_ERROR,
        })
        expect(
            serviceMocks.loadSelectedPermissionsInTransaction,
        ).not.toHaveBeenCalled()

        const superUserPermission = {
            id: 'permission-super-user',
            key: PERMISSIONS.ADMIN_SUPER_USER,
        }
        serviceMocks.loadSelectedPermissionsInTransaction.mockResolvedValueOnce(
            [superUserPermission],
        )

        await expect(
            resolvePermissionSelectionInTransaction(
                {} as never,
                [PERMISSIONS.ADMIN_SUPER_USER],
                { allowSuperUser: true },
            ),
        ).resolves.toEqual({
            success: true,
            permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
            permissions: [superUserPermission],
        })
    })

    it('sperrt zuerst den Actor und prüft seine Rechte nach dem globalen Superuser-Lock', async function () {
        const transaction = { id: 'transaction' }
        serviceMocks.getActiveUserPermissionKeysInTransaction.mockResolvedValueOnce(
            [PERMISSIONS.ADMIN_SUPER_USER],
        )

        await expect(
            hasSuperUserMutationAccessInTransaction(
                transaction as never,
                'actor-user',
            ),
        ).resolves.toBe(true)
        expect(
            serviceMocks.lockAuditUsersInTransactionService,
        ).toHaveBeenCalledWith(transaction, ['actor-user'])
        expect(
            serviceMocks.lockAuditUsersInTransactionService.mock
                .invocationCallOrder[0],
        ).toBeLessThan(
            serviceMocks.lockAndCountActiveSuperUsers.mock
                .invocationCallOrder[0] ?? 0,
        )
        expect(serviceMocks.lockAndCountActiveSuperUsers).toHaveBeenCalledWith(
            transaction,
        )
        expect(
            serviceMocks.getActiveUserPermissionKeysInTransaction,
        ).toHaveBeenCalledWith(transaction, 'actor-user')
        expect(
            serviceMocks.lockAndCountActiveSuperUsers.mock
                .invocationCallOrder[0],
        ).toBeLessThan(
            serviceMocks.getActiveUserPermissionKeysInTransaction.mock
                .invocationCallOrder[0] ?? 0,
        )
    })

    it('verweigert inaktiven Actoren und Actoren ohne Superuser-Recht den Mutationszugriff', async function () {
        serviceMocks.getActiveUserPermissionKeysInTransaction
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce([PERMISSIONS.ADMIN_USER_MANAGEMENT])

        await expect(
            hasSuperUserMutationAccessInTransaction(
                {} as never,
                'inactive-actor',
            ),
        ).resolves.toBe(false)
        await expect(
            hasSuperUserMutationAccessInTransaction(
                {} as never,
                'normal-actor',
            ),
        ).resolves.toBe(false)
        expect(serviceMocks.lockAndCountActiveSuperUsers).toHaveBeenCalledTimes(
            2,
        )
    })
})
