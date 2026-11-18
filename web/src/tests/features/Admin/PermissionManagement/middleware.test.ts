import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    authorize,
    createServerFnStub,
} from '../UserManagement/management-middleware.test.helpers.ts'
import type { Boundary } from '../UserManagement/management-middleware.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const overview = vi.fn()
const users = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const managed = vi.fn()
vi.mock('@tanstack/react-start', () => ({ createServerFn: createServerFnStub }))
vi.mock('@/server/Admin/PermissionManagement/overview.service.ts', () => ({
    getPermissionManagementOverviewService: overview,
}))
vi.mock('@/server/Admin/PermissionManagement/users.service.ts', () => ({
    getPermissionManagementUsersService: users,
}))
vi.mock('@/server/Admin/PermissionManagement/presets.service.ts', () => ({
    createPermissionPresetService: create,
    updatePermissionPresetService: update,
    deletePermissionPresetService: remove,
}))
vi.mock(
    '@/server/Admin/PermissionManagement/managed-user-permissions.service.ts',
    () => ({ replaceManagedUserPermissionsService: managed }),
)
const handlers =
    await import('@/features/Admin/PermissionManagement/middleware.ts')

const id = '01941f29-7c00-7000-8000-000000000001'
const cases = [
    ['getPermissionManagementOverviewHandler', overview, undefined],
    ['getPermissionManagementUsersHandler', users, undefined],
    [
        'createPermissionPresetHandler',
        create,
        {
            name: 'Reader',
            description: '',
            permissionKeys: [PERMISSIONS.USER_DASHBOARD],
        },
    ],
    [
        'updatePermissionPresetHandler',
        update,
        {
            id,
            name: 'Reader',
            description: '',
            permissionKeys: [PERMISSIONS.USER_DASHBOARD],
        },
    ],
    ['deletePermissionPresetHandler', remove, { id }],
    [
        'replaceManagedUserPermissionsHandler',
        managed,
        { userId: id, permissionKeys: [PERMISSIONS.USER_DASHBOARD] },
    ],
] as const

beforeEach(() => {
    vi.clearAllMocks()
    authorize.mockReset().mockResolvedValue({ userId: 'actor' })
    for (const [, service] of cases)
        service.mockReset().mockResolvedValue({ success: true })
})

describe('permission management server boundaries', () => {
    it.each(cases)(
        'requires super-user permission and passes actor identity for %s',
        async (name, service, data) => {
            const handler = handlers[name] as unknown as Boundary
            expect(await handler(data ? { data } : undefined)).toEqual({
                success: true,
            })
            expect(authorize).toHaveBeenCalledWith(PERMISSIONS.ADMIN_SUPER_USER)
            if (data) expect(service).toHaveBeenCalledWith(data, 'actor')
            else expect(service).toHaveBeenCalledWith('actor')
        },
    )

    it.each(cases)(
        'stops %s when super-user authorization fails',
        async (name, service, data) => {
            authorize.mockRejectedValue(new Error('Forbidden'))
            await expect(
                (handlers[name] as unknown as Boundary)(
                    data ? { data } : undefined,
                ),
            ).rejects.toThrow('Forbidden')
            expect(service).not.toHaveBeenCalled()
        },
    )

    it.each(cases.filter(([, , data]) => Boolean(data)))(
        'validates %s before accessing the domain service',
        async (name, service) => {
            await expect(
                (handlers[name] as unknown as Boundary)({ data: {} }),
            ).rejects.toThrow()
            expect(authorize).not.toHaveBeenCalled()
            expect(service).not.toHaveBeenCalled()
        },
    )

    it.each([
        'createPermissionPresetHandler',
        'updatePermissionPresetHandler',
    ] as const)(
        'rejects automatic super-user grants through %s',
        async (name) => {
            await expect(
                (handlers[name] as unknown as Boundary)({
                    data: {
                        id,
                        name: 'Unsafe',
                        description: '',
                        permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                    },
                }),
            ).rejects.toThrow()
            expect(authorize).not.toHaveBeenCalled()
            expect(create).not.toHaveBeenCalled()
            expect(update).not.toHaveBeenCalled()
        },
    )
})
