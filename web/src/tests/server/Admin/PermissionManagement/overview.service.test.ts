import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../AuditLogs/read-query.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const read = createReadDb()
const authorize = vi.fn()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    permissions: table('permissions', ['id', 'key', 'name', 'description']),
    permissionPresets: table('presets', [
        'id',
        'name',
        'description',
        'createdAt',
        'updatedAt',
    ]),
    permissionPresetPermissions: table('presetPermissions', [
        'presetId',
        'permissionId',
    ]),
}))
vi.mock(
    '@/server/Admin/PermissionManagement/permission-management-policy.service.ts',
    () => ({ requireSuperUserReadAccessService: authorize }),
)
const { getPermissionManagementOverviewService } =
    await import('@/server/Admin/PermissionManagement/overview.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    authorize.mockReset().mockResolvedValue(undefined)
    read.results.length = 0
    read.queries.length = 0
})

describe('permission management overview', () => {
    it('groups preset permissions, serializes timestamps and keeps an empty preset', async () => {
        const createdAt = new Date('2026-01-01T12:00:00Z')
        const permission = {
            id: 'dashboard',
            key: PERMISSIONS.USER_DASHBOARD,
            name: 'Dashboard',
            description: '',
        }
        read.results.push(
            [permission],
            [
                {
                    id: 'readers',
                    name: 'Readers',
                    description: '',
                    createdAt,
                    updatedAt: createdAt,
                },
                {
                    id: 'empty',
                    name: 'Empty',
                    description: '',
                    createdAt,
                    updatedAt: createdAt,
                },
            ],
            [
                { presetId: 'readers', key: PERMISSIONS.USER_DASHBOARD },
                { presetId: 'readers', key: PERMISSIONS.ADMIN_DASHBOARD },
            ],
        )
        const overview = await getPermissionManagementOverviewService('actor')
        expect(authorize).toHaveBeenCalledWith('actor')
        expect(overview.permissions).toEqual([permission])
        expect(overview.presets).toEqual([
            {
                id: 'readers',
                name: 'Readers',
                description: '',
                permissionKeys: [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                ],
                createdAt: createdAt.toISOString(),
                updatedAt: createdAt.toISOString(),
            },
            {
                id: 'empty',
                name: 'Empty',
                description: '',
                permissionKeys: [],
                createdAt: createdAt.toISOString(),
                updatedAt: createdAt.toISOString(),
            },
        ])
        const configured = {
            op: 'in',
            column: 'permissions.key',
            values: Object.values(PERMISSIONS),
        }
        expect(read.queries[0]?.where).toHaveBeenCalledWith(configured)
        expect(read.queries[2]?.where).toHaveBeenCalledWith({
            op: 'and',
            conditions: [
                configured,
                {
                    op: 'ne',
                    left: 'permissions.key',
                    right: PERMISSIONS.ADMIN_SUPER_USER,
                },
            ],
        })
    })

    it('returns empty collections when the configured rows have not been seeded', async () => {
        expect(await getPermissionManagementOverviewService('actor')).toEqual({
            permissions: [],
            presets: [],
        })
    })

    it('does not query permissions or users when super-user read access is denied', async () => {
        authorize.mockRejectedValue(new Error('Forbidden'))
        await expect(
            getPermissionManagementOverviewService('actor'),
        ).rejects.toThrow('Forbidden')
        expect(read.db.select).not.toHaveBeenCalled()
    })
})
