import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    PERMISSIONS,
    PUBLIC_PERMISSION_KEYS,
} from '@/config/permissions.config.ts'
import {
    createReadDb,
    operators,
    table,
} from '../AuditLogs/read-query.test.helpers.ts'

const read = createReadDb()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({
    permissions: table('permissions', ['id', 'key', 'name', 'description']),
    accountPermissions: table('accountPermissions', ['userId', 'permissionId']),
    user_profiles: table('profiles', ['userId', 'profileImageUpdatedAt']),
    users: table('users', [
        'id',
        'username',
        'accountType',
        'isDeleted',
        'createdAt',
    ]),
}))
const { getUsersService, getPermissionsService } =
    await import('@/server/Admin/UserManagement/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    read.results.length = 0
    read.queries.length = 0
})

describe('scoped account listing', () => {
    it.each(['public', 'staff'] as const)(
        'filters both the accounts and their permission rows to %s',
        async (accountType) => {
            const profileImageUpdatedAt = new Date('2026-01-03T00:00:00Z')
            const createdAt = new Date('2026-01-02T00:00:00Z')
            const key =
                accountType === 'public'
                    ? PERMISSIONS.USER_DASHBOARD
                    : PERMISSIONS.ADMIN_SUPER_USER
            read.results.push(
                [
                    { id: 'actor', createdAt, profileImageUpdatedAt },
                    { id: 'other', createdAt, profileImageUpdatedAt: null },
                ],
                [{ userId: 'actor', key }],
            )
            const result = await getUsersService(accountType, 'actor')
            expect(result).toEqual([
                expect.objectContaining({
                    id: 'actor',
                    isCurrentUser: true,
                    permissions: [key],
                    isSuperUser: accountType === 'staff',
                    profileImageVersion: profileImageUpdatedAt.getTime(),
                    createdAt: createdAt.toISOString(),
                }),
                expect.objectContaining({
                    id: 'other',
                    isCurrentUser: false,
                    permissions: [],
                    profileImageVersion: null,
                }),
            ])
            const scope = operators.and(
                operators.eq('users.isDeleted', false),
                operators.eq('users.accountType', accountType),
            )
            expect(read.queries[0].where).toHaveBeenCalledWith(scope)
            expect(read.queries[1].where).toHaveBeenCalledWith(scope)
        },
    )

    it('skips permission reads for an empty account listing', async () => {
        expect(await getUsersService('staff', 'actor')).toEqual([])
        expect(read.db.select).toHaveBeenCalledTimes(1)
    })

    it('only offers public permissions as filters on the public accounts table', async () => {
        await getPermissionsService('public')
        await getPermissionsService('staff')
        expect(read.queries[0].where).toHaveBeenCalledWith(
            operators.inArray('permissions.key', [...PUBLIC_PERMISSION_KEYS]),
        )
        expect(read.queries[1].where).toHaveBeenCalledWith(undefined)
    })
})
