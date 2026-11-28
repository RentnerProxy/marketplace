import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getPermissionManagementUsersService } from '@/server/Admin/PermissionManagement/users.service.ts'

const serviceMocks = (function () {
    return {
        hasSuperUserPermission: vi.fn(),
        requireSuperUserReadAccessService: vi.fn(),
    }
})()

const dbMock = (function () {
    const state = {
        permissionRows: [] as Array<Record<string, string>>,
        userRows: [] as Array<Record<string, unknown>>,
    }
    const userSelectChain = {
        from: vi.fn(function () {
            return userSelectChain
        }),
        leftJoin: vi.fn(function () {
            return userSelectChain
        }),
        where: vi.fn(function () {
            return userSelectChain
        }),
        orderBy: vi.fn(async function () {
            return state.userRows
        }),
    }
    const permissionSelectChain = {
        from: vi.fn(function () {
            return permissionSelectChain
        }),
        innerJoin: vi.fn(function () {
            return permissionSelectChain
        }),
        where: vi.fn(function () {
            return permissionSelectChain
        }),
        orderBy: vi.fn(async function () {
            return state.permissionRows
        }),
    }
    const db = {
        select: vi.fn(function (selection: Record<string, unknown>) {
            return 'username' in selection
                ? userSelectChain
                : permissionSelectChain
        }),
    }

    return {
        db,
        permissionSelectChain,
        state,
        userSelectChain,
    }
})()

vi.mock('@/db', function () {
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return {
        permissions: {
            id: 'permissions.id',
            key: 'permissions.key',
        },
        staffUserPermissions: {
            permissionId: 'staffUserPermissions.permissionId',
            userId: 'staffUserPermissions.userId',
        },
        user_profiles: {
            userId: 'user_profiles.userId',
        },
        users: {
            createdAt: 'users.createdAt',
            email: 'users.email',
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
            username: 'users.username',
        },
    }
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        asc: vi.fn(function (column: unknown) {
            return { type: 'asc', column }
        }),
        desc: vi.fn(function (column: unknown) {
            return { type: 'desc', column }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
        inArray: vi.fn(function (column: unknown, values: Array<unknown>) {
            return { type: 'inArray', column, values }
        }),
    }
})

vi.mock('@/lib/Permissions/permissions.ts', function () {
    return {
        hasSuperUserPermission: serviceMocks.hasSuperUserPermission,
    }
})

vi.mock(
    '@/server/Admin/PermissionManagement/permission-management-policy.service.ts',
    function () {
        return {
            requireSuperUserReadAccessService:
                serviceMocks.requireSuperUserReadAccessService,
        }
    },
)

const actorUserId = '11111111-1111-4111-8111-111111111111'
const managedUserId = '22222222-2222-4222-8222-222222222222'

describe('getPermissionManagementUsersService', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        dbMock.state.userRows = [
            {
                id: actorUserId,
                username: 'admin',
                email: 'admin@example.test',
                isActive: true,
                createdAt: new Date('2026-01-02T00:00:00.000Z'),
            },
            {
                id: managedUserId,
                username: 'user',
                email: 'user@example.test',
                isActive: false,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]
        dbMock.state.permissionRows = [
            {
                userId: actorUserId,
                key: PERMISSIONS.ADMIN_SUPER_USER,
            },
            {
                userId: managedUserId,
                key: PERMISSIONS.USER_DASHBOARD,
            },
        ]
        serviceMocks.requireSuperUserReadAccessService.mockResolvedValue(
            undefined,
        )
        serviceMocks.hasSuperUserPermission.mockImplementation(
            (permissionKeys: Array<string>) =>
                permissionKeys.includes(PERMISSIONS.ADMIN_SUPER_USER),
        )
    })

    it('liefert alle verwalteten Benutzer mit ihrem sicheren Permission-Vertrag', async function () {
        await expect(
            getPermissionManagementUsersService(actorUserId),
        ).resolves.toEqual([
            {
                id: actorUserId,
                username: 'admin',
                email: 'admin@example.test',
                isActive: true,
                isSuperUser: true,
                isCurrentUser: true,
                permissions: [PERMISSIONS.ADMIN_SUPER_USER],
            },
            {
                id: managedUserId,
                username: 'user',
                email: 'user@example.test',
                isActive: false,
                isSuperUser: false,
                isCurrentUser: false,
                permissions: [PERMISSIONS.USER_DASHBOARD],
            },
        ])

        expect(
            serviceMocks.requireSuperUserReadAccessService,
        ).toHaveBeenCalledWith(actorUserId)
        expect(dbMock.db.select).toHaveBeenCalledTimes(2)
        expect(dbMock.userSelectChain.orderBy).toHaveBeenCalledTimes(1)
        expect(dbMock.permissionSelectChain.orderBy).toHaveBeenCalledTimes(1)
    })

    it('überspringt die Permission-Abfrage bei einer leeren Benutzerliste', async function () {
        dbMock.state.userRows = []

        await expect(
            getPermissionManagementUsersService(actorUserId),
        ).resolves.toEqual([])

        expect(dbMock.db.select).toHaveBeenCalledTimes(1)
        expect(dbMock.permissionSelectChain.orderBy).not.toHaveBeenCalled()
    })

    it('liest ohne bestätigten Superuser-Zugriff keine Benutzerdaten', async function () {
        const accessError = new Error('Zugriff verweigert')
        serviceMocks.requireSuperUserReadAccessService.mockRejectedValueOnce(
            accessError,
        )

        await expect(
            getPermissionManagementUsersService(actorUserId),
        ).rejects.toBe(accessError)
        expect(dbMock.db.select).not.toHaveBeenCalled()
    })
})
