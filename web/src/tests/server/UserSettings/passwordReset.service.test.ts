import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@/db'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'
import { requestCurrentUserPasswordResetService } from '@/server/UserSettings/Security/password-reset.service.ts'

const schemaMock = (function () {
    return {
        passwordResetTokens: {
            userId: 'passwordResetTokens.userId',
            tokenHash: 'passwordResetTokens.tokenHash',
            expiresAt: 'passwordResetTokens.expiresAt',
        },
        trustedDevices: {},
        twoFactorAuth: {},
        users: {
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})()

const serviceMocks = (function () {
    return {
        enqueuePasswordResetMail: vi.fn(async function () {}),
        getCurrentUserSettingsSession: vi.fn(async function () {
            return {
                id: 'user-1',
                username: 'kevin',
                email: 'kevin@example.test',
            }
        }),
        writeAuditLog: vi.fn(async function () {}),
    }
})()

const dbMock = (function () {
    const state = {
        cleanupWhereConditions: [] as Array<unknown>,
        transactionSelectResults: [] as Array<Array<unknown>>,
    }

    function createTransactionSelectChain() {
        const chain = {
            from: vi.fn(function () {
                return chain
            }),
            where: vi.fn(function () {
                return chain
            }),
            limit: vi.fn(function () {
                return chain
            }),
            for: vi.fn(async function () {
                return state.transactionSelectResults.shift() ?? []
            }),
        }

        return chain
    }

    const transaction = {
        select: vi.fn(createTransactionSelectChain),
        delete: vi.fn(function () {
            return {
                where: vi.fn(async function (condition: unknown) {
                    if (
                        typeof condition === 'object' &&
                        condition !== null &&
                        'type' in condition &&
                        condition.type === 'and'
                    ) {
                        state.cleanupWhereConditions.push(condition)
                    }
                }),
            }
        }),
        insert: vi.fn(function () {
            return {
                values: vi.fn(async function () {}),
            }
        }),
    }
    const databaseMock = {
        transaction: vi.fn(async function (
            callback: (transaction: unknown) => unknown,
        ) {
            return callback(transaction)
        }),
        delete: vi.fn(function () {
            return {
                where: vi.fn(async function (condition: unknown) {
                    state.cleanupWhereConditions.push(condition)
                }),
            }
        }),
    }

    return { db: databaseMock, state, transaction }
})()

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

vi.mock('@/db', function () {
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getCurrentUserSettingsSession:
            serviceMocks.getCurrentUserSettingsSession,
    }
})

vi.mock('@/lib/Auth/tokens.ts', function () {
    return {
        createTokenHash: vi.fn(async function () {
            return 'token-hash'
        }),
    }
})

vi.mock('@/server/Queues/mail.queue.ts', function () {
    return {
        enqueuePasswordResetMail: serviceMocks.enqueuePasswordResetMail,
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            return { actorUserId, route: null, method: 'POST' }
        },
        async writeAuditLogInTransactionService(
            transaction: unknown,
            _input: unknown,
        ) {
            expect(transaction).toBe(dbMock.transaction)
            await serviceMocks.writeAuditLog()
            return { id: 'audit-1', createdAt: new Date() }
        },
        async publishCommittedAuditLogService() {},
    }
})

const mockedDb = db
const mockedEnqueuePasswordResetMail = enqueuePasswordResetMail as Mock<
    typeof enqueuePasswordResetMail
>

describe('Current-user Password-Reset', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        dbMock.state.cleanupWhereConditions = []
        dbMock.state.transactionSelectResults = [
            [{ id: 'user-1' }],
            [{ id: 'user-1' }],
        ]
    })

    it('ersetzt das Token unter Benutzersperre in einer Transaktion', async function () {
        const result = await requestCurrentUserPasswordResetService()

        expect(result).toEqual({ success: true })
        expect(mockedDb.transaction).toHaveBeenCalledTimes(1)
        expect(dbMock.transaction.select).toHaveBeenCalledWith({
            id: schemaMock.users.id,
        })
        expect(dbMock.transaction.delete).toHaveBeenCalledWith(
            schemaMock.passwordResetTokens,
        )
        expect(dbMock.transaction.insert).toHaveBeenCalledWith(
            schemaMock.passwordResetTokens,
        )
    })

    it('löscht bei Queue-Fehlern nur das selbst erzeugte Token', async function () {
        mockedEnqueuePasswordResetMail.mockRejectedValueOnce(
            new Error('Queue nicht erreichbar'),
        )

        const result = await requestCurrentUserPasswordResetService()

        expect(result).toMatchObject({ success: false })
        expect(dbMock.state.cleanupWhereConditions).toEqual([
            {
                type: 'and',
                conditions: [
                    {
                        type: 'eq',
                        left: schemaMock.passwordResetTokens.userId,
                        right: 'user-1',
                    },
                    {
                        type: 'eq',
                        left: schemaMock.passwordResetTokens.tokenHash,
                        right: 'token-hash',
                    },
                ],
            },
        ])
    })
})
