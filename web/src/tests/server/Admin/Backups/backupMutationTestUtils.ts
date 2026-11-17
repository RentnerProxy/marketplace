import { vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type {
    BackupAuditHarness,
    BackupMutationPolicyState,
    BackupMutationRevocation,
} from './backupMutationTestUtils.types.ts'

export const backupMutationRevocations: Array<BackupMutationRevocation> = [
    'permission',
    'inactive',
    'deleted',
    'missing',
]

const schema = {
    users: {
        id: 'users.id',
        isActive: 'users.isActive',
        isDeleted: 'users.isDeleted',
    },
    permissions: { id: 'permissions.id', key: 'permissions.key' },
    accountPermissions: {
        userId: 'accountPermissions.userId',
        permissionId: 'accountPermissions.permissionId',
    },
}

function assertCondition(condition: unknown, left: string, right: unknown) {
    if (
        !condition ||
        typeof condition !== 'object' ||
        !('left' in condition) ||
        !('right' in condition) ||
        condition.left !== left ||
        condition.right !== right
    ) {
        throw new Error('Unexpected actor policy condition')
    }
}

function isPolicySelection(projection: unknown) {
    if (!projection || typeof projection !== 'object') return false
    return (
        ('isActive' in projection &&
            'isDeleted' in projection &&
            projection.isActive === schema.users.isActive &&
            projection.isDeleted === schema.users.isDeleted) ||
        ('key' in projection && projection.key === schema.permissions.key)
    )
}

export function createBackupMutationMocks(audit: BackupAuditHarness) {
    const lockedActors = new Map<unknown, string | null>()
    const state: BackupMutationPolicyState = {
        exists: true,
        isActive: true,
        isDeleted: false,
        permissionKeys: [PERMISSIONS.ADMIN_BACKUPS],
        beforeLock: null,
    }
    const lockUsers = vi.fn(async function (
        transaction: DatabaseTransaction,
        userIds: Array<string | null>,
    ) {
        await state.beforeLock?.()
        await audit.lockUsers(transaction, userIds)
        lockedActors.set(transaction, userIds.at(0) ?? null)
    })

    const selectPolicy = vi.fn(function (
        transaction: unknown,
        projection: unknown,
    ) {
        if (!lockedActors.has(transaction) || !isPolicySelection(projection)) {
            throw new Error('Policy must read its locked transaction')
        }
        const userId = lockedActors.get(transaction)
        return {
            from(table: unknown) {
                return {
                    where(condition: unknown) {
                        if (table !== schema.users) {
                            throw new Error('Unexpected actor table')
                        }
                        assertCondition(condition, schema.users.id, userId)
                        return {
                            async limit(count: number) {
                                if (count !== 1) {
                                    throw new Error('Unbounded actor read')
                                }
                                return state.exists
                                    ? [
                                          {
                                              isActive: state.isActive,
                                              isDeleted: state.isDeleted,
                                          },
                                      ]
                                    : []
                            },
                        }
                    },
                    innerJoin(joinedTable: unknown, condition: unknown) {
                        if (
                            table !== schema.accountPermissions ||
                            joinedTable !== schema.permissions
                        ) {
                            throw new Error('Unexpected permission join')
                        }
                        assertCondition(
                            condition,
                            schema.permissions.id,
                            schema.accountPermissions.permissionId,
                        )
                        return {
                            async where(userCondition: unknown) {
                                assertCondition(
                                    userCondition,
                                    schema.accountPermissions.userId,
                                    userId,
                                )
                                return state.permissionKeys.map((key) => ({
                                    key,
                                }))
                            },
                        }
                    },
                }
            },
        }
    })

    function revokeAtLock(revocation: BackupMutationRevocation) {
        state.beforeLock = function () {
            if (revocation === 'permission') state.permissionKeys = []
            if (revocation === 'inactive') state.isActive = false
            if (revocation === 'deleted') state.isDeleted = true
            if (revocation === 'missing') state.exists = false
        }
    }

    function reset() {
        lockedActors.clear()
        state.exists = true
        state.isActive = true
        state.isDeleted = false
        state.permissionKeys = [PERMISSIONS.ADMIN_BACKUPS]
        state.beforeLock = null
    }

    return {
        schema,
        state,
        lockUsers,
        isPolicySelection,
        selectPolicy,
        revokeAtLock,
        reset,
    }
}
