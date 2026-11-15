import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    TransactionAuthorizationTestCondition,
    TransactionAuthorizationTestState,
} from './transaction-authorization.test.types.ts'

export const transactionAuthorizationSchema = {
    users: {
        id: 'users.id',
        isActive: 'users.isActive',
        isDeleted: 'users.isDeleted',
    },
    permissions: { id: 'permissions.id', key: 'permissions.key' },
    userPermissions: {
        userId: 'userPermissions.userId',
        permissionId: 'userPermissions.permissionId',
    },
}

export function createTransactionAuthorizationHarness() {
    const state: TransactionAuthorizationTestState = {
        userId: '00000000-0000-4000-8000-000000000002',
        present: true,
        isActive: true,
        isDeleted: false,
        permissionKeys: [PERMISSIONS.ADMIN_BACKUPS],
        events: [],
        beforeLock: async function () {},
    }
    const { users, permissions, userPermissions } =
        transactionAuthorizationSchema
    const transaction = {
        select(selection: Record<string, unknown>) {
            return {
                from(table: unknown) {
                    if (table === users) {
                        return {
                            where(
                                condition: TransactionAuthorizationTestCondition,
                            ) {
                                if (condition.column !== users.id)
                                    throw new Error(
                                        'Unexpected actor predicate',
                                    )
                                const matches = () =>
                                    state.present &&
                                    condition.value === state.userId
                                return {
                                    limit(maximum: number) {
                                        if (maximum !== 1)
                                            throw new Error(
                                                'Expected bounded actor read',
                                            )
                                        if (selection.id === users.id) {
                                            return {
                                                async for(mode: string) {
                                                    if (mode !== 'update')
                                                        throw new Error(
                                                            'Expected actor update lock',
                                                        )
                                                    state.events.push(
                                                        'lock:requested',
                                                    )
                                                    await state.beforeLock()
                                                    state.events.push(
                                                        'lock:acquired',
                                                    )
                                                    return matches()
                                                        ? [{ id: state.userId }]
                                                        : []
                                                },
                                            }
                                        }
                                        state.events.push('active-read')
                                        return Promise.resolve(
                                            matches()
                                                ? [
                                                      {
                                                          isActive:
                                                              state.isActive,
                                                          isDeleted:
                                                              state.isDeleted,
                                                      },
                                                  ]
                                                : [],
                                        )
                                    },
                                }
                            },
                        }
                    }
                    if (
                        table !== userPermissions ||
                        selection.key !== permissions.key
                    )
                        throw new Error('Unexpected permission source')
                    return {
                        innerJoin(
                            joined: unknown,
                            condition: TransactionAuthorizationTestCondition,
                        ) {
                            if (
                                joined !== permissions ||
                                condition.column !== permissions.id ||
                                condition.value !== userPermissions.permissionId
                            )
                                throw new Error('Unexpected permission join')
                            return {
                                async where(
                                    predicate: TransactionAuthorizationTestCondition,
                                ) {
                                    if (
                                        predicate.column !==
                                        userPermissions.userId
                                    )
                                        throw new Error(
                                            'Missing actor permission predicate',
                                        )
                                    state.events.push('permission-read')
                                    return predicate.value === state.userId
                                        ? state.permissionKeys.map((key) => ({
                                              key,
                                          }))
                                        : []
                                },
                            }
                        },
                    }
                },
            }
        },
    }
    return { state, transaction }
}
