import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveUserPermissionKeysInTransaction } from '@/server/Auth/transaction-authorization.service.ts'
import { describe, expect, it, vi } from 'bun:test'
import {
    getAddedPermissionKeys,
    getRemovedPermissionKeys,
    getUserPermissionPolicyContextInTransaction,
    lockAndCountActiveSuperUsers,
} from '@/server/Admin/UserManagement/permissionContext.service.ts'

const schemaMock = (function () {
    return {
        permissions: {
            id: 'permissions.id',
            key: 'permissions.key',
        },
        userPermissions: {
            permissionId: 'userPermissions.permissionId',
            userId: 'userPermissions.userId',
        },
        users: {
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})()

vi.mock('@/db', function () {
    return { db: { transaction: vi.fn() } }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        count: vi.fn(function () {
            return 'count'
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
    }
})

function createSelectChain(
    terminal: 'for' | 'limit' | 'where',
    result: Array<Record<string, unknown>>,
) {
    const chain = {
        from: vi.fn(function () {
            return chain
        }),
        innerJoin: vi.fn(function () {
            return chain
        }),
        where: vi.fn(function () {
            return terminal === 'where' ? Promise.resolve(result) : chain
        }),
        limit: vi.fn(function () {
            return terminal === 'limit' ? Promise.resolve(result) : chain
        }),
        for: vi.fn(async function () {
            return result
        }),
    }

    return chain
}

function createTransaction(
    ...chains: Array<ReturnType<typeof createSelectChain>>
) {
    return {
        select: vi.fn(function () {
            const chain = chains.shift()
            if (!chain) {
                throw new Error('Unerwartete Select-Abfrage')
            }
            return chain
        }),
    }
}

describe('UserManagement Permission-Kontext', function () {
    it('ermittelt hinzugefügte und entfernte Berechtigungen stabil', function () {
        expect(
            getAddedPermissionKeys(
                ['admin.dashboard'],
                ['admin.dashboard', 'admin.users'],
            ),
        ).toEqual(['admin.users'])
        expect(
            getRemovedPermissionKeys(
                ['admin.dashboard', 'admin.users'],
                ['admin.users'],
            ),
        ).toEqual(['admin.dashboard'])
    })

    it('liest Permission-Keys aus der Transaktion', async function () {
        const transaction = createTransaction(
            createSelectChain('where', [
                { key: 'admin.dashboard' },
                { key: 'admin.users' },
            ]),
        )

        await expect(
            getUserPermissionKeys('user-1', transaction as never),
        ).resolves.toEqual(['admin.dashboard', 'admin.users'])
    })

    it('liefert nur für aktive, nicht gelöschte Benutzer Berechtigungen', async function () {
        await expect(
            getActiveUserPermissionKeysInTransaction({} as never, null),
        ).resolves.toBeNull()

        const inactiveUserResults = await Promise.all(
            [
                [],
                [{ isActive: false, isDeleted: false }],
                [{ isActive: true, isDeleted: true }],
            ].map(function (userRows) {
                const transaction = createTransaction(
                    createSelectChain('limit', userRows),
                )
                return getActiveUserPermissionKeysInTransaction(
                    transaction as never,
                    'user-1',
                )
            }),
        )
        expect(inactiveUserResults).toEqual([null, null, null])

        const transaction = createTransaction(
            createSelectChain('limit', [{ isActive: true, isDeleted: false }]),
            createSelectChain('where', [{ key: 'admin.users' }]),
        )
        await expect(
            getActiveUserPermissionKeysInTransaction(
                transaction as never,
                'user-1',
            ),
        ).resolves.toEqual(['admin.users'])
    })

    it('zählt aktive Superuser unter einem Lock', async function () {
        const withoutPermission = createTransaction(
            createSelectChain('for', []),
        )
        await expect(
            lockAndCountActiveSuperUsers(withoutPermission as never),
        ).resolves.toBe(0)

        const withCount = createTransaction(
            createSelectChain('for', [{ id: 'permission-1' }]),
            createSelectChain('where', [{ value: 3 }]),
        )
        await expect(
            lockAndCountActiveSuperUsers(withCount as never),
        ).resolves.toBe(3)

        const withoutCount = createTransaction(
            createSelectChain('for', [{ id: 'permission-1' }]),
            createSelectChain('where', []),
        )
        await expect(
            lockAndCountActiveSuperUsers(withoutCount as never),
        ).resolves.toBe(0)
    })

    it('lädt den Policy-Kontext in stabiler Lock-Reihenfolge', async function () {
        const transaction = createTransaction(
            createSelectChain('where', [{ key: 'admin.target' }]),
            createSelectChain('for', [{ id: 'permission-1' }]),
            createSelectChain('where', [{ value: 2 }]),
            createSelectChain('limit', [{ isActive: true, isDeleted: false }]),
            createSelectChain('where', [{ key: 'admin.current' }]),
        )

        await expect(
            getUserPermissionPolicyContextInTransaction(
                transaction as never,
                'target-user',
                'current-user',
            ),
        ).resolves.toEqual({
            targetPermissionKeys: ['admin.target'],
            activeSuperUserCount: 2,
            currentUserPermissionKeys: ['admin.current'],
        })
    })
})
