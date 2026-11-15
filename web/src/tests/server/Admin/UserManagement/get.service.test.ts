import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    getPermissionsService,
    getUsersService,
} from '@/server/Admin/UserManagement/get.service.ts'

const serviceMocks = (function () {
    return {
        getCurrentUserAccess: vi.fn(),
        getVisiblePermissionKeys: vi.fn(),
        hasSuperUserPermission: vi.fn(),
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
        from: vi.fn(function (): unknown {
            return Object.assign(
                Promise.resolve(state.permissionRows),
                permissionSelectChain,
            )
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
            description: 'permissions.description',
            id: 'permissions.id',
            key: 'permissions.key',
            name: 'permissions.name',
        },
        userPermissions: {
            permissionId: 'userPermissions.permissionId',
            userId: 'userPermissions.userId',
        },
        user_profiles: {
            city: 'user_profiles.city',
            firstName: 'user_profiles.firstName',
            houseNumber: 'user_profiles.houseNumber',
            lastName: 'user_profiles.lastName',
            postalCode: 'user_profiles.postalCode',
            profileImageUpdatedAt: 'user_profiles.profileImageUpdatedAt',
            street: 'user_profiles.street',
            userId: 'user_profiles.userId',
        },
        users: {
            createdAt: 'users.createdAt',
            createdByUserId: 'users.createdByUserId',
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
        asc: vi.fn(function (column: unknown) {
            return { type: 'asc', column }
        }),
        desc: vi.fn(function (column: unknown) {
            return { type: 'desc', column }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
    }
})

vi.mock('@/lib/Permissions/permissions.ts', function () {
    return {
        getVisiblePermissionKeys: serviceMocks.getVisiblePermissionKeys,
        hasSuperUserPermission: serviceMocks.hasSuperUserPermission,
        SUPER_USER_PERMISSION: 'admin.super-user',
    }
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return { getCurrentUserAccess: serviceMocks.getCurrentUserAccess }
})

const actorUserId = '11111111-1111-4111-8111-111111111111'
const managedUserId = '22222222-2222-4222-8222-222222222222'

describe('getUsersService', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        dbMock.state.userRows = [
            {
                id: actorUserId,
                username: 'admin',
                email: 'admin@example.test',
                firstName: 'Ada',
                lastName: 'Admin',
                street: null,
                houseNumber: null,
                postalCode: null,
                city: null,
                profileImageUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
                isActive: true,
                createdByUserId: null,
                createdAt: new Date('2026-01-02T00:00:00.000Z'),
            },
            {
                id: managedUserId,
                username: 'user',
                email: 'user@example.test',
                firstName: null,
                lastName: null,
                street: null,
                houseNumber: null,
                postalCode: null,
                city: null,
                profileImageUpdatedAt: null,
                isActive: false,
                createdByUserId: actorUserId,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]
        dbMock.state.permissionRows = [
            { userId: actorUserId, key: 'admin.users' },
            { userId: managedUserId, key: 'admin.super-user' },
        ]
        serviceMocks.getCurrentUserAccess.mockResolvedValue({
            userId: actorUserId,
            isSuperUser: false,
        })
        serviceMocks.hasSuperUserPermission.mockImplementation(
            (permissionKeys: Array<string>) =>
                permissionKeys.includes('admin.super-user'),
        )
        serviceMocks.getVisiblePermissionKeys.mockImplementation(
            (permissionKeys: Array<string>) =>
                permissionKeys.filter(
                    (permissionKey) => permissionKey !== 'admin.super-user',
                ),
        )
    })

    it('liefert alle sichtbaren Benutzer ohne serverseitige Seitengrenze', async function () {
        await expect(getUsersService()).resolves.toEqual([
            expect.objectContaining({
                id: actorUserId,
                isCurrentUser: true,
                isDefaultUser: true,
                isSuperUser: false,
                permissions: ['admin.users'],
                profileImageVersion: new Date(
                    '2026-01-03T00:00:00.000Z',
                ).getTime(),
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
            expect.objectContaining({
                id: managedUserId,
                isCurrentUser: false,
                isDefaultUser: false,
                isSuperUser: true,
                permissions: [],
                profileImageVersion: null,
                createdAt: '2026-01-01T00:00:00.000Z',
            }),
        ])

        expect(dbMock.db.select).toHaveBeenCalledTimes(2)
        expect(dbMock.userSelectChain.orderBy).toHaveBeenCalledTimes(1)
        expect(dbMock.permissionSelectChain.orderBy).toHaveBeenCalledTimes(1)
    })

    it('überspringt die Permission-Abfrage bei einer leeren Benutzerliste', async function () {
        dbMock.state.userRows = []

        await expect(getUsersService()).resolves.toEqual([])

        expect(dbMock.db.select).toHaveBeenCalledTimes(1)
        expect(dbMock.permissionSelectChain.orderBy).not.toHaveBeenCalled()
    })

    it('hides super-user permission definitions from restricted actors', async () => {
        dbMock.state.permissionRows = [
            {
                id: 'normal',
                key: 'admin.users',
                name: 'Users',
                description: '',
            },
            {
                id: 'super',
                key: 'admin.super-user',
                name: 'Super',
                description: '',
            },
        ]
        expect(await getPermissionsService()).toEqual([
            {
                id: 'normal',
                key: 'admin.users',
                name: 'Users',
                description: '',
            },
        ])
    })

    it('lets super users inspect all permission definitions and assigned super-user keys', async () => {
        serviceMocks.getCurrentUserAccess.mockResolvedValue({
            userId: actorUserId,
            isSuperUser: true,
        })
        const users = await getUsersService()
        expect(users[1]?.permissions).toEqual(['admin.super-user'])
        expect(serviceMocks.getVisiblePermissionKeys).not.toHaveBeenCalled()
        const permission = {
            id: 'super',
            key: 'admin.super-user',
            name: 'Super',
            description: '',
        }
        dbMock.state.permissionRows = [permission]
        expect(await getPermissionsService()).toEqual([permission])
    })

    it('returns an empty permission list for users without assignments', async () => {
        dbMock.state.permissionRows = []
        expect(
            (await getUsersService()).map((user) => user.permissions),
        ).toEqual([[], []])
    })

    it('does not read administrative rows when current access cannot be established', async () => {
        serviceMocks.getCurrentUserAccess.mockRejectedValue(
            new Error('Session unavailable'),
        )
        await expect(getUsersService()).rejects.toThrow('Session unavailable')
        await expect(getPermissionsService()).rejects.toThrow(
            'Session unavailable',
        )
        expect(dbMock.db.select).not.toHaveBeenCalled()
    })
})
