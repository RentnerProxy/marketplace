import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { TWO_FACTOR_SETUP_DURATION_MS } from '@/config/security.config.ts'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { createPendingTwoFactorSetup } from '@/server/UserSettings/Security/two-factor-setup.service.ts'
import { decryptAuthSecret } from '@/lib/Auth/secretEncryption.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { createReauthenticationProofService } from '@/server/Auth/reauthentication-proof.service.ts'

const committedAuditReceipt = {
    id: '70123a96-d7e4-4868-a6b7-2cddebf25ec5',
    createdAt: new Date('2026-09-05T18:23:41.527Z'),
}
const enqueueSecurityChange = vi.fn(async function (
    _input: SecurityChangeMailInput,
) {
    dbMock.state.events.push('notification')
})
const logNotificationError = vi.fn()
const publishSessionRevocation = vi.fn(async function (
    _payload: UserSessionsRevokedEvent['payload'],
) {
    dbMock.state.events.push('sessions:revoked')
})
const publishAudit = vi.fn(async function () {
    dbMock.state.events.push('publish')
})
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishUserSessionsRevokedService: publishSessionRevocation,
}))

vi.mock('@/server/Logging/logger.ts', () => ({
    logError: logNotificationError,
}))

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

const schemaMock = (function () {
    return {
        sessions: {
            id: 'sessions.id',
            userId: 'sessions.userId',
            expiresAt: 'sessions.expiresAt',
        },
        passwordResetTokens: {
            userId: 'passwordResetTokens.userId',
        },
        trustedDevices: {
            table: 'trustedDevices',
            userId: 'trustedDevices.userId',
        },
        twoFactorAuth: {
            table: 'twoFactorAuth',
            id: 'twoFactorAuth.id',
            userId: 'twoFactorAuth.userId',
            secret: 'twoFactorAuth.secret',
            verified: 'twoFactorAuth.verified',
        },
        users: {
            table: 'users',
            username: 'users.username',
            email: 'users.email',
            passwordHash: 'users.passwordHash',
            isTwoFactorEnabled: 'users.isTwoFactorEnabled',
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})()

const serviceMocks = (function () {
    return {
        createTotp: vi.fn(async function () {
            return {
                toString: function (): string {
                    return 'otpauth://totp/test'
                },
            }
        }),
        createTotpSecret: vi.fn(function () {
            return 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
        }),
        getCurrentUserSettingsSession: vi.fn(),
        getActiveCurrentSessionUser: vi.fn(),
        getTotpCodeStep: vi.fn(function (): number | null {
            return 1234
        }),
        reauthenticateCurrentUserService: vi.fn(),
        writeAuditLog: vi.fn(async function () {
            return undefined
        }),
    }
})()

function createLockedUser(enabled = false, passwordHash = 'password-hash') {
    return {
        id: 'user-1',
        username: 'kevin',
        email: 'kevin@example.test',
        passwordHash,
        isTwoFactorEnabled: enabled,
    }
}

const securityTestSessions = [
    { id: 'a'.repeat(64), userId: 'user-1' },
    { id: 'b'.repeat(64), userId: 'user-1' },
    { id: 'c'.repeat(64), userId: 'other-user' },
]

const dbMock = (function () {
    const state = {
        committedWrites: [] as Array<string>,
        committedAudits: [] as Array<Record<string, unknown>>,
        events: [] as Array<string>,
        isTwoFactorEnabled: false,
        passwordHash: 'password-hash',
        factorId: 'factor-1',
        sessionExpiresAt: new Date(Date.now() + 300_000),
        sessionRows: structuredClone(securityTestSessions),
        failSessionDelete: false,
        deleteConditions: [] as Array<unknown>,
        insertValues: [] as Array<{ secret: string }>,
        updateValues: [] as Array<{
            secret?: string
            verified?: boolean
            isTwoFactorEnabled?: boolean
        }>,
        updateConditions: [] as Array<unknown>,
        dbSelectResults: [] as Array<Array<unknown>>,
        transactionSelectResults: [] as Array<Array<unknown>>,
        transactionDeleteResults: [] as Array<Array<unknown>>,
        transactionInsertResults: [] as Array<Array<unknown>>,
        transactionUpdateResults: [] as Array<Array<unknown>>,
    }

    let stagedWrites: Array<string> | null = null
    let stagedAudits: Array<Record<string, unknown>> | null = null
    let stagedSessionRows: typeof state.sessionRows | null = null

    function lockedSessionRows() {
        return (stagedSessionRows ?? state.sessionRows)
            .filter(
                (session) =>
                    session.id === 'a'.repeat(64) &&
                    session.userId === 'user-1',
            )
            .map((session) => ({
                id: session.id,
                userId: session.userId,
                expiresAt: state.sessionExpiresAt,
            }))
    }

    const lockUser = vi.fn(async function (_query: {
        table: unknown
        condition: unknown
        mode: string
    }) {
        return [createLockedUser(state.isTwoFactorEnabled, state.passwordHash)]
    })
    const lockSession = vi.fn(async function () {
        return lockedSessionRows()
    })
    const lockFactor = vi.fn(async function () {
        return [
            {
                id: state.factorId,
                userId: 'user-1',
                verified: state.isTwoFactorEnabled,
            },
        ]
    })

    function createSelectChain(resultType: 'database' | 'transaction') {
        let table: unknown
        let condition: unknown
        const chain = {
            from: vi.fn(function (selectedTable: unknown) {
                table = selectedTable
                return chain
            }),
            where: vi.fn(function (selectedCondition: unknown) {
                condition = selectedCondition
                return chain
            }),
            limit: vi.fn(function () {
                let lockRequested = false
                const selectedRows = Promise.resolve().then(function () {
                    if (lockRequested) return []
                    const results =
                        resultType === 'database'
                            ? state.dbSelectResults
                            : state.transactionSelectResults
                    return results.shift() ?? []
                })
                return Object.assign(selectedRows, {
                    for: function (mode: string) {
                        lockRequested = true
                        if (resultType !== 'transaction')
                            throw new Error('Expected transaction lock')
                        if (table === schemaMock.users)
                            return lockUser({ table, condition, mode })
                        if (table === schemaMock.sessions) return lockSession()
                        return lockFactor()
                    },
                })
            }),
        }

        return chain
    }

    function createDeleteChain(table: unknown) {
        const chain = {
            where: vi.fn(function (condition: unknown) {
                state.deleteConditions.push(condition)
                if (table === schemaMock.sessions) {
                    if (!stagedSessionRows)
                        throw new Error('Session deletion outside transaction')
                    if (state.failSessionDelete)
                        throw new Error('Synthetic session deletion failure')
                    if (
                        !condition ||
                        typeof condition !== 'object' ||
                        !('type' in condition) ||
                        condition.type !== 'eq' ||
                        !('left' in condition) ||
                        condition.left !== schemaMock.sessions.userId ||
                        !('right' in condition) ||
                        typeof condition.right !== 'string'
                    )
                        throw new Error('Expected a session owner predicate')
                    stagedSessionRows = stagedSessionRows.filter(
                        (session) => session.userId !== condition.right,
                    )
                }
                return chain
            }),
            returning: vi.fn(async function () {
                if (table === schemaMock.sessions)
                    throw new Error(
                        'Session revocation must not return session IDs',
                    )
                return state.transactionDeleteResults.shift() ?? []
            }),
        }

        return chain
    }

    function createInsertChain() {
        const chain = {
            values: vi.fn(function (values: { secret: string }) {
                state.insertValues.push(values)
                return chain
            }),
            onConflictDoNothing: vi.fn(function () {
                return chain
            }),
            returning: vi.fn(async function () {
                return state.transactionInsertResults.shift() ?? []
            }),
        }

        return chain
    }

    function createUpdateChain() {
        const chain = {
            set: vi.fn(function (values: {
                secret?: string
                verified?: boolean
                isTwoFactorEnabled?: boolean
            }) {
                state.updateValues.push(values)
                return chain
            }),
            where: vi.fn(function (condition: unknown) {
                state.updateConditions.push(condition)
                return chain
            }),
            returning: vi.fn(async function () {
                return state.transactionUpdateResults.shift() ?? []
            }),
        }

        return chain
    }

    const transaction = {
        recordAudit(input: Record<string, unknown>) {
            if (!stagedAudits) throw new Error('Audit outside transaction')
            const receipt = {
                ...committedAuditReceipt,
                createdAt: new Date(committedAuditReceipt.createdAt),
            }
            stagedAudits.push({ ...input, ...receipt })
            state.events.push('audit')
            return receipt
        },
        select: vi.fn(function () {
            return createSelectChain('transaction')
        }),
        delete: vi.fn(function (table: unknown) {
            if (!stagedWrites) throw new Error('Delete outside transaction')
            stagedWrites.push('delete')
            return createDeleteChain(table)
        }),
        insert: vi.fn(function () {
            if (!stagedWrites) throw new Error('Insert outside transaction')
            stagedWrites.push('insert')
            return createInsertChain()
        }),
        update: vi.fn(function () {
            if (!stagedWrites) throw new Error('Update outside transaction')
            stagedWrites.push('update')
            return createUpdateChain()
        }),
    }

    const db = {
        select: vi.fn(function () {
            return createSelectChain('database')
        }),
        transaction: vi.fn(async function (
            callback: (transaction: unknown) => unknown,
        ) {
            stagedWrites = []
            stagedAudits = []
            stagedSessionRows = structuredClone(state.sessionRows)
            state.events.push('begin')
            try {
                const result = await callback(transaction)
                state.committedWrites.push(...stagedWrites)
                state.committedAudits.push(...stagedAudits)
                state.sessionRows = stagedSessionRows
                state.events.push('commit')
                return result
            } catch (error) {
                state.events.push('rollback')
                throw error
            } finally {
                stagedWrites = null
                stagedAudits = null
                stagedSessionRows = null
            }
        }),
    }

    return {
        db,
        state,
        transaction,
        lockUser,
        lockSession,
        lockFactor,
        lockedSessionRows,
    }
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
    return {
        db: dbMock.db,
    }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getCurrentUserSettingsSession:
            serviceMocks.getCurrentUserSettingsSession,
        getActiveCurrentSessionUser: serviceMocks.getActiveCurrentSessionUser,
    }
})

vi.mock('@/lib/Auth/totp.ts', function () {
    return {
        createTotp: serviceMocks.createTotp,
        createTotpSecret: serviceMocks.createTotpSecret,
        getTotpCodeStep: serviceMocks.getTotpCodeStep,
    }
})

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function () {
            return 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
        },
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            dbMock.state.events.push('context')
            return { actorUserId, route: null, method: 'POST' }
        },
        writeAuditLogInTransactionService: vi.fn(async function (
            transaction: typeof dbMock.transaction,
            input: Record<string, unknown>,
        ) {
            await serviceMocks.writeAuditLog()
            return transaction.recordAudit(input)
        }),
        publishCommittedAuditLogService: publishAudit,
    }
})

vi.mock('@/server/Auth/reauthentication.service.ts', function () {
    return {
        reauthenticateCurrentUserService:
            serviceMocks.reauthenticateCurrentUserService,
    }
})

vi.mock('@/server/Queues/mail.queue.ts', function () {
    return {
        enqueueSecurityChangeMail: enqueueSecurityChange,
        enqueuePasswordResetMail: vi.fn(async function () {
            return undefined
        }),
    }
})

const {
    beginCurrentUserTwoFactorSetupService,
    confirmCurrentUserTwoFactorSetupService,
    disableCurrentUserTwoFactorService,
} = await import('@/server/UserSettings/Security/two-factor.service.ts')

const mockedGetActiveCurrentSessionUser = getActiveCurrentSessionUser as Mock<
    typeof getActiveCurrentSessionUser
>
const mockedWriteAuditLog = writeAuditLogInTransactionService as Mock<
    typeof writeAuditLogInTransactionService
>

async function setAuthenticatedUser(enabled = false) {
    dbMock.state.isTwoFactorEnabled = enabled
    const currentUser = {
        id: 'user-1',
        sessionHash: 'a'.repeat(64),
        username: 'kevin',
        email: 'kevin@example.test',
        customBackgroundDarkness: null,
        fontFamily: 'inter',
        fontSize: 16,
        primaryColor: null,
        themeMode: 'dark',
        isActive: true,
        isDeleted: false,
        expiresAt: new Date(Date.now() + 60_000),
    }

    serviceMocks.getCurrentUserSettingsSession.mockResolvedValue(currentUser)
    mockedGetActiveCurrentSessionUser.mockResolvedValue(currentUser)
    serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
        success: true,
        currentUser: {
            ...currentUser,
            isTwoFactorEnabled: enabled,
        },
        proof: await createReauthenticationProofService(
            createLockedUser(enabled, dbMock.state.passwordHash),
            enabled ? dbMock.state.factorId : null,
            currentUser.sessionHash,
        ),
    })
}

let credentialVersion = ''
let pendingSetup: Awaited<ReturnType<typeof createPendingTwoFactorSetup>>

async function runTwoFactorMutation(mutation: 'begin' | 'confirm' | 'disable') {
    const factor = {
        id: 'factor-1',
        secret: pendingSetup.encryptedSetup,
        verified: false,
    }

    if (mutation === 'begin') {
        dbMock.state.transactionSelectResults = [[factor]]
        dbMock.state.transactionDeleteResults = [[{ id: 'factor-1' }]]
        dbMock.state.transactionInsertResults = [[{ id: 'factor-2' }]]
        return beginCurrentUserTwoFactorSetupService({
            reauthentication: { method: 'password', credential: 'existing' },
        })
    }

    if (mutation === 'confirm') {
        dbMock.state.dbSelectResults = [[factor]]
        dbMock.state.transactionUpdateResults = [
            [{ id: 'factor-1' }],
            [{ id: 'user-1' }],
        ]
        return confirmCurrentUserTwoFactorSetupService({
            token: '123456',
            setupToken: pendingSetup.setupToken,
        })
    }

    await setAuthenticatedUser(true)
    dbMock.state.transactionDeleteResults = [[{ id: 'factor-1' }]]
    dbMock.state.transactionUpdateResults = [[{ id: 'user-1' }]]
    return disableCurrentUserTwoFactorService({
        reauthentication: { method: 'totp', credential: '123456' },
    })
}

function expectActiveUserLock() {
    expect(dbMock.lockUser).toHaveBeenCalledWith({
        table: schemaMock.users,
        mode: 'update',
        condition: {
            type: 'and',
            conditions: [
                { type: 'eq', left: schemaMock.users.id, right: 'user-1' },
                { type: 'eq', left: schemaMock.users.isActive, right: true },
                { type: 'eq', left: schemaMock.users.isDeleted, right: false },
            ],
        },
    })
}

describe('UserSettings 2FA-Invarianten', function () {
    beforeEach(async function () {
        vi.clearAllMocks()
        enqueueSecurityChange.mockReset().mockImplementation(async function () {
            dbMock.state.events.push('notification')
        })
        logNotificationError.mockReset()
        publishSessionRevocation
            .mockReset()
            .mockImplementation(async function () {
                dbMock.state.events.push('sessions:revoked')
            })
        publishAudit.mockReset().mockImplementation(async function () {
            dbMock.state.events.push('publish')
        })
        dbMock.lockUser.mockReset()
        dbMock.lockUser.mockImplementation(async function () {
            return [
                createLockedUser(
                    dbMock.state.isTwoFactorEnabled,
                    dbMock.state.passwordHash,
                ),
            ]
        })
        dbMock.lockSession.mockReset().mockImplementation(async function () {
            return dbMock.lockedSessionRows()
        })
        dbMock.lockFactor.mockReset().mockImplementation(async function () {
            return [
                {
                    id: dbMock.state.factorId,
                    userId: 'user-1',
                    verified: dbMock.state.isTwoFactorEnabled,
                },
            ]
        })
        dbMock.state.committedWrites = []
        dbMock.state.committedAudits = []
        dbMock.state.events = []
        dbMock.state.passwordHash = 'password-hash'
        dbMock.state.factorId = 'factor-1'
        dbMock.state.sessionExpiresAt = new Date(Date.now() + 300_000)
        dbMock.state.sessionRows = structuredClone(securityTestSessions)
        dbMock.state.failSessionDelete = false
        dbMock.state.deleteConditions = []
        dbMock.state.insertValues = []
        dbMock.state.updateValues = []
        dbMock.state.updateConditions = []
        dbMock.state.dbSelectResults = []
        dbMock.state.transactionSelectResults = []
        dbMock.state.transactionDeleteResults = []
        dbMock.state.transactionInsertResults = []
        dbMock.state.transactionUpdateResults = []
        await setAuthenticatedUser()
        credentialVersion = (
            await createReauthenticationProofService(
                createLockedUser(),
                null,
                'a'.repeat(64),
            )
        ).credentialVersion
        pendingSetup = await createPendingTwoFactorSetup(
            'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
            'user-1',
            'a'.repeat(64),
            credentialVersion,
        )
    })

    it.each(['begin', 'confirm', 'disable'] as const)(
        'does not commit staged %s writes when mandatory auditing fails',
        async function (mutation) {
            const beforeSessions = structuredClone(dbMock.state.sessionRows)
            serviceMocks.writeAuditLog.mockRejectedValueOnce(
                new Error('Synthetic audit failure'),
            )
            await expect(runTwoFactorMutation(mutation)).rejects.toThrow(
                'Synthetic audit failure',
            )
            expect(dbMock.state.committedWrites).toEqual([])
            expect(dbMock.state.committedAudits).toEqual([])
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'rollback',
            ])
            expect(dbMock.state.sessionRows).toEqual(beforeSessions)
            expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
            expect(
                Object.is(
                    mockedWriteAuditLog.mock.calls[0][0],
                    dbMock.transaction,
                ),
            ).toBe(true)
        },
    )

    it.each(['begin', 'confirm', 'disable'] as const)(
        'commits %s audit before publishing and omits its receipt from the public result',
        async function (mutation) {
            const result = await runTwoFactorMutation(mutation)
            expect(result.success).toBe(true)
            expect(dbMock.state.committedWrites.length).toBeGreaterThan(0)
            expect(dbMock.state.committedAudits).toHaveLength(1)
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'audit',
                'commit',
                ...(mutation === 'begin'
                    ? []
                    : ['notification', 'sessions:revoked']),
                'publish',
            ])
            expect(result).not.toHaveProperty('auditReceipt')
            expect(result).not.toHaveProperty('revocationUserId')
            expect(dbMock.state.sessionRows).toEqual(
                mutation === 'begin'
                    ? securityTestSessions
                    : [securityTestSessions[2]],
            )
            expect(
                dbMock.transaction.delete.mock.calls.filter(
                    ([table]) => table === schemaMock.trustedDevices,
                ),
            ).toHaveLength(mutation === 'disable' ? 1 : 0)
            expect(publishSessionRevocation).toHaveBeenCalledTimes(
                mutation === 'begin' ? 0 : 1,
            )
            if (mutation !== 'begin') {
                expect(dbMock.state.committedAudits[0]).toMatchObject({
                    newValues: { sessionsRevoked: 'all' },
                })
                expect(publishSessionRevocation.mock.calls).toEqual([
                    [
                        {
                            userId: 'user-1',
                            revokedAt:
                                committedAuditReceipt.createdAt.toISOString(),
                        },
                    ],
                ])
            }
            expect(enqueueSecurityChange).toHaveBeenCalledTimes(
                mutation === 'begin' ? 0 : 1,
            )
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'notifies %s once using the locked recipient and committed audit snapshot before publishing',
        async function (mutation) {
            const lockedEmail = 'locked-contact@example.test'
            const observedState = {
                events: dbMock.state.events.slice(),
                committedWrites: dbMock.state.committedWrites.slice(),
                committedAudits: dbMock.state.committedAudits.slice(),
                sessionRows: structuredClone(dbMock.state.sessionRows),
            }
            dbMock.lockUser.mockResolvedValueOnce([
                {
                    ...createLockedUser(mutation === 'disable'),
                    email: lockedEmail,
                },
            ])
            enqueueSecurityChange.mockImplementationOnce(async function () {
                observedState.events = dbMock.state.events.slice()
                observedState.committedWrites =
                    dbMock.state.committedWrites.slice()
                observedState.committedAudits =
                    dbMock.state.committedAudits.slice()
                observedState.sessionRows = structuredClone(
                    dbMock.state.sessionRows,
                )
                expect(publishSessionRevocation).not.toHaveBeenCalled()
                dbMock.state.events.push('notification')
            })

            expect(await runTwoFactorMutation(mutation)).toEqual({
                success: true,
            })

            expect(observedState.events).toEqual([
                'context',
                'begin',
                'audit',
                'commit',
            ])
            expect(observedState.committedWrites).toEqual(
                mutation === 'confirm'
                    ? ['update', 'update', 'delete']
                    : ['delete', 'delete', 'update', 'delete'],
            )
            expect(observedState.committedAudits).toHaveLength(1)
            expect(observedState.sessionRows).toEqual([securityTestSessions[2]])
            expect(observedState.committedAudits[0]).toMatchObject(
                committedAuditReceipt,
            )
            expect(enqueueSecurityChange.mock.calls).toEqual([
                [
                    {
                        to: lockedEmail,
                        change:
                            mutation === 'confirm'
                                ? 'totp_enabled'
                                : 'totp_disabled',
                        changedAt:
                            committedAuditReceipt.createdAt.toISOString(),
                        auditEventId: committedAuditReceipt.id,
                    },
                ],
            ])
            expect(await getActiveCurrentSessionUser()).toMatchObject({
                email: 'kevin@example.test',
            })
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'audit',
                'commit',
                'notification',
                'sessions:revoked',
                'publish',
            ])
            expect(logNotificationError).not.toHaveBeenCalled()
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'keeps the %s commit and success when notification enqueueing fails',
        async function (mutation) {
            const queueFailure = new Error('Synthetic queue unavailable')
            enqueueSecurityChange.mockImplementationOnce(async function () {
                dbMock.state.events.push('notification')
                throw queueFailure
            })

            expect(await runTwoFactorMutation(mutation)).toEqual({
                success: true,
            })
            expect(dbMock.state.committedWrites).toEqual(
                mutation === 'confirm'
                    ? ['update', 'update', 'delete']
                    : ['delete', 'delete', 'update', 'delete'],
            )
            expect(dbMock.state.committedAudits).toHaveLength(1)
            expect(dbMock.state.committedAudits[0]).toMatchObject(
                committedAuditReceipt,
            )
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'audit',
                'commit',
                'notification',
                'sessions:revoked',
                'publish',
            ])
            expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
            expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
            expect(dbMock.state.sessionRows).toEqual([securityTestSessions[2]])
            expect(logNotificationError).toHaveBeenCalledTimes(1)
            expect(logNotificationError).toHaveBeenCalledWith(
                'auth.security_change_notification.failed',
                queueFailure,
                { auditLogId: committedAuditReceipt.id },
            )
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'rolls back the %s factor change and all sessions when session deletion fails',
        async function (mutation) {
            const beforeSessions = structuredClone(dbMock.state.sessionRows)
            dbMock.state.failSessionDelete = true
            await expect(runTwoFactorMutation(mutation)).rejects.toThrow(
                'Synthetic session deletion failure',
            )
            expect(dbMock.state.sessionRows).toEqual(beforeSessions)
            expect(dbMock.state.committedWrites).toEqual([])
            expect(dbMock.state.committedAudits).toEqual([])
            expect(dbMock.transaction.update).toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'rollback',
            ])
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'cannot reuse the revoked current session for another %s mutation',
        async function (mutation) {
            expect(await runTwoFactorMutation(mutation)).toEqual({
                success: true,
            })
            const writes = dbMock.state.committedWrites.slice()
            expect(await runTwoFactorMutation(mutation)).toMatchObject({
                success: false,
            })
            expect(dbMock.state.sessionRows).toEqual([securityTestSessions[2]])
            expect(dbMock.state.committedWrites).toEqual(writes)
            expect(dbMock.state.committedAudits).toHaveLength(1)
            expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
            expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'publishes committed %s revocation before a failing audit publication',
        async function (mutation) {
            publishAudit.mockImplementationOnce(async function () {
                dbMock.state.events.push('publish')
                throw new Error('Synthetic audit publication failure')
            })
            await expect(runTwoFactorMutation(mutation)).rejects.toThrow(
                'Synthetic audit publication failure',
            )
            expect(dbMock.state.sessionRows).toEqual([securityTestSessions[2]])
            expect(dbMock.state.committedAudits).toHaveLength(1)
            expect(dbMock.state.events).toEqual([
                'context',
                'begin',
                'audit',
                'commit',
                'notification',
                'sessions:revoked',
                'publish',
            ])
            expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
            expect(publishSessionRevocation.mock.calls).toEqual([
                [
                    {
                        userId: 'user-1',
                        revokedAt:
                            committedAuditReceipt.createdAt.toISOString(),
                    },
                ],
            ])
        },
    )

    it.each(['confirm', 'disable'] as const)(
        'keeps committed %s success and audit publication if realtime fails',
        async function (mutation) {
            const failure = new Error('Synthetic realtime outage')
            publishSessionRevocation.mockRejectedValueOnce(failure)
            expect(await runTwoFactorMutation(mutation)).toEqual({
                success: true,
            })
            expect(dbMock.state.sessionRows).toEqual([securityTestSessions[2]])
            expect(dbMock.state.committedAudits).toHaveLength(1)
            expect(dbMock.state.events.at(-1)).toBe('publish')
            expect(publishAudit).toHaveBeenCalledTimes(1)
            expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
            expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
            expect(logNotificationError.mock.calls).toEqual([
                [
                    'auth.factor_change.realtime_revoke_failed',
                    failure,
                    { auditLogId: committedAuditReceipt.id },
                ],
            ])
        },
    )

    it('does not notify when disabling a factor that was already removed', async function () {
        await setAuthenticatedUser(true)
        dbMock.state.transactionDeleteResults = [[]]

        expect(
            await disableCurrentUserTwoFactorService({
                reauthentication: {
                    method: 'totp',
                    credential: '123456',
                },
            }),
        ).toMatchObject({ success: false })

        expect(dbMock.transaction.delete).toHaveBeenCalledTimes(1)
        expect(dbMock.state.sessionRows).toEqual(securityTestSessions)
        expect(dbMock.transaction.update).not.toHaveBeenCalled()
        expect(dbMock.state.committedAudits).toEqual([])
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(logNotificationError).not.toHaveBeenCalled()
    })

    it('rolls back pending-setup deletion when the replacement insert returns no row', async function () {
        dbMock.state.transactionSelectResults = [
            [{ id: 'factor-1', verified: false }],
        ]
        dbMock.state.transactionDeleteResults = [[{ id: 'factor-1' }]]
        dbMock.state.transactionInsertResults = [[]]
        await expect(
            beginCurrentUserTwoFactorSetupService({
                reauthentication: {
                    method: 'password',
                    credential: 'existing',
                },
            }),
        ).rejects.toThrow('Das 2FA-Setup konnte nicht angelegt werden.')
        expect(dbMock.transaction.delete).toHaveBeenCalledTimes(1)
        expect(dbMock.transaction.insert).toHaveBeenCalledTimes(1)
        expect(dbMock.state.committedWrites).toEqual([])
        expect(dbMock.state.committedAudits).toEqual([])
        expect(dbMock.state.events.at(-1)).toBe('rollback')
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('überschreibt einen bestehenden verifizierten Faktor nicht', async function () {
        dbMock.state.transactionSelectResults = [
            [{ id: 'factor-1', verified: true }],
        ]

        const result = await beginCurrentUserTwoFactorSetupService({
            reauthentication: { method: 'password', credential: 'existing' },
        })

        expect(result).toMatchObject({ success: false })
        expect(dbMock.db.transaction).toHaveBeenCalledTimes(1)
        expect(dbMock.transaction.delete).not.toHaveBeenCalled()
        expect(dbMock.transaction.insert).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('bestätigt Faktor und Benutzer-Flag in einer Transaktion', async function () {
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: pendingSetup.encryptedSetup,
                    verified: false,
                },
            ],
        ]
        dbMock.state.transactionUpdateResults = [
            [{ id: 'factor-1' }],
            [{ id: 'user-1' }],
        ]

        const result = await confirmCurrentUserTwoFactorSetupService({
            token: '123456',
            setupToken: pendingSetup.setupToken,
        })

        expect(result).toEqual({ success: true })
        expect(dbMock.db.transaction).toHaveBeenCalledTimes(1)
        expect(dbMock.transaction.update).toHaveBeenNthCalledWith(
            1,
            schemaMock.twoFactorAuth,
        )
        expect(dbMock.transaction.update).toHaveBeenNthCalledWith(
            2,
            schemaMock.users,
        )
        expect(mockedWriteAuditLog).toHaveBeenCalledWith(
            dbMock.transaction,
            expect.objectContaining({ action: 'user.two_factor_enabled' }),
        )
    })

    it('aktiviert das Benutzer-Flag nicht, wenn sich das Setup geändert hat', async function () {
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: pendingSetup.encryptedSetup,
                    verified: false,
                },
            ],
        ]
        dbMock.state.transactionUpdateResults = [[]]

        const result = await confirmCurrentUserTwoFactorSetupService({
            token: '123456',
            setupToken: pendingSetup.setupToken,
        })

        expect(result).toMatchObject({ success: false })
        expect(dbMock.transaction.update).toHaveBeenCalledTimes(1)
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('widerruft beim Deaktivieren Faktor und Trusted Devices atomar', async function () {
        await setAuthenticatedUser(true)
        dbMock.state.transactionDeleteResults = [[{ id: 'factor-1' }]]
        dbMock.state.transactionUpdateResults = [[{ id: 'user-1' }]]

        const result = await disableCurrentUserTwoFactorService({
            reauthentication: {
                method: 'totp',
                credential: '123456',
            },
        })

        expect(result).toEqual({ success: true })
        expect(dbMock.db.transaction).toHaveBeenCalledTimes(1)
        expect(dbMock.transaction.delete).toHaveBeenNthCalledWith(
            1,
            schemaMock.twoFactorAuth,
        )
        expect(dbMock.transaction.delete).toHaveBeenNthCalledWith(
            2,
            schemaMock.trustedDevices,
        )
        expect(dbMock.transaction.update).toHaveBeenCalledWith(schemaMock.users)
        expect(dbMock.state.deleteConditions[0]).toEqual({
            type: 'and',
            conditions: [
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.id,
                    right: 'factor-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.userId,
                    right: 'user-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.verified,
                    right: true,
                },
            ],
        })
        expect(mockedWriteAuditLog).toHaveBeenCalledWith(
            dbMock.transaction,
            expect.objectContaining({ action: 'user.two_factor_disabled' }),
        )
    })

    it('ändert 2FA ohne erfolgreiche Step-up-Prüfung nicht', async function () {
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })

        const result = await disableCurrentUserTwoFactorService({
            reauthentication: {
                method: 'totp',
                credential: '000000',
            },
        })

        expect(result).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('bestätigt ein Pending-Setup nicht ohne aktuelle Sitzung', async function () {
        mockedGetActiveCurrentSessionUser.mockResolvedValue(null)

        const result = await confirmCurrentUserTwoFactorSetupService({
            token: '123456',
            setupToken: pendingSetup.setupToken,
        })

        expect(result).toEqual({
            success: false,
            error: 'Du bist nicht angemeldet.',
        })
        expect(dbMock.db.select).not.toHaveBeenCalled()
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('does not generate or persist an enrollment secret without reauthentication', async function () {
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValueOnce({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        const result = await beginCurrentUserTwoFactorSetupService({
            reauthentication: { method: 'password', credential: 'wrong' },
        })
        expect(result.success).toBe(false)
        expect(serviceMocks.createTotpSecret).not.toHaveBeenCalled()
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
    })

    it('does not begin enrollment if the authenticated session changed during reauthentication', async function () {
        mockedGetActiveCurrentSessionUser.mockResolvedValueOnce(null)
        const result = await beginCurrentUserTwoFactorSetupService({
            reauthentication: { method: 'password', credential: 'existing' },
        })
        expect(result.success).toBe(false)
        expect(serviceMocks.createTotpSecret).not.toHaveBeenCalled()
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
    })

    it('returns a session-bound setup token only after reauthentication and persistence', async function () {
        dbMock.state.transactionSelectResults = [[]]
        dbMock.state.transactionInsertResults = [[{ id: 'factor-1' }]]
        const result = await beginCurrentUserTwoFactorSetupService({
            reauthentication: { method: 'password', credential: 'existing' },
        })
        expect(result.success).toBe(true)
        if (!result.success) {
            throw new Error('Expected successful enrollment start')
        }
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(result.secret).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')
        expect(typeof result.setupToken).toBe('string')
        expect(result).not.toHaveProperty('proof')
        expect(JSON.stringify(result)).not.toContain(credentialVersion)
        expect(JSON.stringify(result)).not.toContain('password-hash')
        expect(
            serviceMocks.reauthenticateCurrentUserService,
        ).toHaveBeenCalledWith({
            method: 'password',
            credential: 'existing',
        })
        const stored = dbMock.state.insertValues.at(0)
        if (!stored) {
            throw new Error('Expected persisted pending setup')
        }
        expect(stored.secret).not.toContain('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')
        const decrypted: unknown = JSON.parse(
            await decryptAuthSecret(stored.secret),
        )
        expect(decrypted).toMatchObject({
            purpose: 'two-factor-setup-v2',
            userId: 'user-1',
            sessionHash: 'a'.repeat(64),
        })
        expect(decrypted).toMatchObject({
            setupTokenHash: await createTokenHash(result.setupToken),
        })
        expect(await getActiveCurrentSessionUser()).toMatchObject({
            id: 'user-1',
            sessionHash: 'a'.repeat(64),
        })
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: stored.secret,
                    verified: false,
                },
            ],
        ]
        dbMock.state.transactionUpdateResults = [
            [{ id: 'factor-1' }],
            [{ id: 'user-1' }],
        ]
        expect(
            await confirmCurrentUserTwoFactorSetupService({
                token: '123456',
                setupToken: result.setupToken,
            }),
        ).toEqual({ success: true })
        const activatedSecret = dbMock.state.updateValues[0]?.secret
        if (!activatedSecret) {
            throw new Error('Expected encrypted active TOTP seed')
        }
        expect(
            JSON.parse(await decryptAuthSecret(activatedSecret)),
        ).toMatchObject({
            purpose: 'totp-state-v1',
            secret: result.secret,
            factorId: 'factor-1',
            userId: 'user-1',
            lastConsumedStep: 1234,
        })
        expect(dbMock.state.updateConditions[0]).toEqual({
            type: 'and',
            conditions: [
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.id,
                    right: 'factor-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.userId,
                    right: 'user-1',
                },
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.secret,
                    right: stored.secret,
                },
                {
                    type: 'eq',
                    left: schemaMock.twoFactorAuth.verified,
                    right: false,
                },
            ],
        })
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: activatedSecret,
                    verified: true,
                },
            ],
        ]
        expect(
            await confirmCurrentUserTwoFactorSetupService({
                token: '123456',
                setupToken: result.setupToken,
            }),
        ).toMatchObject({ success: false, restartSetup: true })
        expect(dbMock.transaction.update).toHaveBeenCalledTimes(2)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it.each([false, true])(
        'does not activate a setup with another token/session (%s)',
        async function (otherSession) {
            dbMock.state.dbSelectResults = [
                [
                    {
                        id: 'factor-1',
                        secret: pendingSetup.encryptedSetup,
                        verified: false,
                    },
                ],
            ]
            if (otherSession) {
                const current = await getActiveCurrentSessionUser()
                mockedGetActiveCurrentSessionUser.mockResolvedValueOnce({
                    ...current!,
                    sessionHash: 'b'.repeat(64),
                })
            }
            const result = await confirmCurrentUserTwoFactorSetupService({
                token: '123456',
                setupToken: otherSession
                    ? pendingSetup.setupToken
                    : crypto.randomUUID(),
            })
            expect(result).toMatchObject({ success: false, restartSetup: true })
            expect(serviceMocks.getTotpCodeStep).not.toHaveBeenCalled()
            expect(dbMock.db.transaction).not.toHaveBeenCalled()
        },
    )

    it('does not activate legacy pending seeds, even with a correct new-factor code', async function () {
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
                    verified: false,
                },
            ],
        ]
        const result = await confirmCurrentUserTwoFactorSetupService({
            token: '123456',
            setupToken: pendingSetup.setupToken,
        })
        expect(result).toMatchObject({ success: false, restartSetup: true })
        expect(serviceMocks.getTotpCodeStep).not.toHaveBeenCalled()
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
    })

    it('allows retry of the same valid setup after an incorrect new-factor code', async function () {
        serviceMocks.getTotpCodeStep.mockReturnValueOnce(null)
        dbMock.state.dbSelectResults = [
            [
                {
                    id: 'factor-1',
                    secret: pendingSetup.encryptedSetup,
                    verified: false,
                },
            ],
        ]
        const result = await confirmCurrentUserTwoFactorSetupService({
            token: '000000',
            setupToken: pendingSetup.setupToken,
        })
        expect(result).toEqual({
            success: false,
            error: 'Der 2FA-Code ist ungültig.',
        })
        expect(dbMock.db.transaction).not.toHaveBeenCalled()
    })

    it.each(['begin', 'confirm', 'disable'] as const)(
        'waits for the active user lock before %s changes factor or device rows',
        async function (mutation) {
            let releaseLock:
                | ((rows: Array<ReturnType<typeof createLockedUser>>) => void)
                | undefined
            dbMock.lockUser.mockReturnValueOnce(
                new Promise<Array<ReturnType<typeof createLockedUser>>>(
                    (resolve) => {
                        releaseLock = resolve
                    },
                ),
            )
            const operation = runTwoFactorMutation(mutation)
            await waitForAssertion(() =>
                expect(dbMock.lockUser).toHaveBeenCalledTimes(1),
            )

            expectActiveUserLock()
            expect(dbMock.transaction.select).toHaveBeenCalledTimes(1)
            expect(dbMock.transaction.insert).not.toHaveBeenCalled()
            expect(dbMock.transaction.delete).not.toHaveBeenCalled()
            expect(dbMock.transaction.update).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()

            releaseLock?.([
                createLockedUser(
                    dbMock.state.isTwoFactorEnabled,
                    dbMock.state.passwordHash,
                ),
            ])
            expect(await operation).toMatchObject({ success: true })
        },
    )

    it.each(['begin', 'confirm', 'disable'] as const)(
        'rejects %s without child mutations when no active user can be locked',
        async function (mutation) {
            dbMock.lockUser.mockResolvedValueOnce([])
            expect(await runTwoFactorMutation(mutation)).toMatchObject({
                success: false,
            })
            expectActiveUserLock()
            expect(dbMock.transaction.select).toHaveBeenCalledTimes(1)
            expect(dbMock.transaction.insert).not.toHaveBeenCalled()
            expect(dbMock.transaction.delete).not.toHaveBeenCalled()
            expect(dbMock.transaction.update).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )

    it.each(['begin', 'confirm', 'disable'] as const)(
        'rejects a revoked session inside the %s transaction before side effects',
        async function (mutation) {
            dbMock.lockSession.mockResolvedValueOnce([])
            expect(await runTwoFactorMutation(mutation)).toMatchObject({
                success: false,
            })
            expect(dbMock.lockUser).toHaveBeenCalledTimes(1)
            expect(dbMock.lockSession).toHaveBeenCalledTimes(1)
            expect(dbMock.lockFactor).not.toHaveBeenCalled()
            expect(dbMock.transaction.insert).not.toHaveBeenCalled()
            expect(dbMock.transaction.delete).not.toHaveBeenCalled()
            expect(dbMock.transaction.update).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )

    it.each(['begin', 'disable'] as const)(
        'rejects password replacement after reauthentication before %s',
        async function (mutation) {
            dbMock.lockUser.mockImplementationOnce(async function () {
                return [
                    createLockedUser(
                        dbMock.state.isTwoFactorEnabled,
                        'changed-password-hash',
                    ),
                ]
            })
            expect(await runTwoFactorMutation(mutation)).toMatchObject({
                success: false,
            })
            expect(dbMock.transaction.insert).not.toHaveBeenCalled()
            expect(dbMock.transaction.delete).not.toHaveBeenCalled()
            expect(dbMock.transaction.update).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )

    it('invalidates an existing pending setup after a password-version change', async function () {
        dbMock.state.passwordHash = 'replacement-password-hash'
        expect(await runTwoFactorMutation('confirm')).toMatchObject({
            success: false,
            restartSetup: true,
        })
        expect(dbMock.transaction.update).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('does not remove a replacement verified factor or trusted devices', async function () {
        dbMock.lockFactor.mockResolvedValueOnce([
            { id: 'replacement-factor', userId: 'user-1', verified: true },
        ])
        expect(await runTwoFactorMutation('disable')).toMatchObject({
            success: false,
        })
        expect(dbMock.transaction.delete).not.toHaveBeenCalled()
        expect(dbMock.transaction.update).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('does not start setup when proof expires during the user-lock wait', async function () {
        const now = Date.now()
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
        dbMock.lockUser.mockImplementationOnce(async function () {
            clock.mockReturnValue(now + 60_000)
            return [createLockedUser()]
        })
        try {
            expect(await runTwoFactorMutation('begin')).toMatchObject({
                success: false,
            })
            expect(dbMock.transaction.insert).not.toHaveBeenCalled()
            expect(dbMock.transaction.delete).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        } finally {
            clock.mockRestore()
        }
    })

    it('rechecks setup expiry after waiting for the user lock', async function () {
        let releaseLock:
            | ((rows: Array<ReturnType<typeof createLockedUser>>) => void)
            | undefined
        dbMock.lockUser.mockReturnValueOnce(
            new Promise<Array<ReturnType<typeof createLockedUser>>>(
                (resolve) => {
                    releaseLock = resolve
                },
            ),
        )
        const clock = vi.spyOn(Date, 'now')

        try {
            const operation = runTwoFactorMutation('confirm')
            await waitForAssertion(() =>
                expect(dbMock.lockUser).toHaveBeenCalledTimes(1),
            )
            clock.mockReturnValue(Date.now() + TWO_FACTOR_SETUP_DURATION_MS)
            releaseLock?.([
                createLockedUser(
                    dbMock.state.isTwoFactorEnabled,
                    dbMock.state.passwordHash,
                ),
            ])

            expect(await operation).toMatchObject({
                success: false,
                restartSetup: true,
            })
            expectActiveUserLock()
            expect(dbMock.transaction.update).not.toHaveBeenCalled()
            expect(mockedWriteAuditLog).not.toHaveBeenCalled()
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        } finally {
            clock.mockRestore()
            releaseLock?.([
                createLockedUser(
                    dbMock.state.isTwoFactorEnabled,
                    dbMock.state.passwordHash,
                ),
            ])
        }
    })
    it.each(['begin', 'confirm', 'disable'] as const)(
        'records a revoked %s session exactly once',
        async function (mutation) {
            dbMock.lockSession.mockResolvedValueOnce([])
            expect((await runTwoFactorMutation(mutation)).success).toBe(false)
            expect(mockedRejection.mock.calls).toEqual([
                ['reauthentication', 'stale_proof'],
            ])
        },
    )

    it.each(['begin', 'confirm', 'disable'] as const)(
        'does not count successful %s as rejected authentication',
        async function (mutation) {
            expect((await runTwoFactorMutation(mutation)).success).toBe(true)
            expect(mockedRejection).not.toHaveBeenCalled()
        },
    )

    it('records an invalid setup TOTP once without the code or secret', async function () {
        serviceMocks.getTotpCodeStep.mockReturnValueOnce(null)
        expect((await runTwoFactorMutation('confirm')).success).toBe(false)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'invalid_two_factor'],
        ])
    })

    it('records a session switch between reauthentication and setup begin once', async function () {
        serviceMocks.getActiveCurrentSessionUser.mockResolvedValueOnce(null)
        expect((await runTwoFactorMutation('begin')).success).toBe(false)
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'stale_proof'],
        ])
    })

    it('does not label an infrastructure exception during factor locking as rejected proof', async function () {
        const storage = new Error('synthetic locking failure')
        dbMock.lockUser.mockRejectedValueOnce(storage)
        await expect(runTwoFactorMutation('confirm')).rejects.toBe(storage)
        expect(mockedRejection).not.toHaveBeenCalled()
    })
})
