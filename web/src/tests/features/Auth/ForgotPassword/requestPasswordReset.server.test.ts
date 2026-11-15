import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { db } from '@/db'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'

function noop() {}

const enumerationMocks = (function () {
    const guards: Array<{ wait: ReturnType<typeof vi.fn> }> = []
    const state = {
        waitImplementation: async function () {},
    }
    const create = vi.fn(function () {
        const guard = {
            wait: vi.fn(function () {
                return state.waitImplementation()
            }),
        }
        guards.push(guard)
        return guard
    })

    return { create, guards, state }
})()

const dbMock = (function () {
    const state = {
        selectResults: [] as Array<Array<unknown>>,
        deleteWhere: vi.fn(async function () {
            return undefined
        }),
        insertValues: vi.fn(async function () {
            return undefined
        }),
    }

    function createInitialSelectChain() {
        const chain = {
            from: vi.fn(function () {
                return chain
            }),
            where: vi.fn(function () {
                return chain
            }),
            limit: vi.fn(async function () {
                return state.selectResults.shift() ?? []
            }),
        }

        return chain
    }

    function createLockedSelectChain() {
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
                return state.selectResults.shift() ?? []
            }),
        }

        return chain
    }

    const deleteMock = vi.fn(function () {
        return {
            where: state.deleteWhere,
        }
    })
    const insertMock = vi.fn(function () {
        return {
            values: state.insertValues,
        }
    })
    const transactionDb = {
        select: vi.fn(createLockedSelectChain),
        delete: deleteMock,
        insert: insertMock,
    }
    const databaseMock = {
        select: vi.fn(createInitialSelectChain),
        delete: deleteMock,
        insert: insertMock,
        transaction: vi.fn(async function (callback) {
            return callback(transactionDb)
        }),
    }

    return {
        state,
        db: databaseMock,
    }
})()

vi.mock('@tanstack/react-start', function () {
    return {
        createServerFn: vi.fn(function () {
            return {
                validator: vi.fn(function () {
                    return {
                        handler: vi.fn(function (handler) {
                            return handler
                        }),
                    }
                }),
            }
        }),
    }
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
        or: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'or', conditions }
        }),
    }
})

vi.mock('@/db', function () {
    return {
        db: dbMock.db,
    }
})

vi.mock('@/db/schema.ts', function () {
    return {
        passwordResetTokens: {
            userId: 'passwordResetTokens.userId',
            tokenHash: 'passwordResetTokens.tokenHash',
            expiresAt: 'passwordResetTokens.expiresAt',
        },
        users: {
            id: 'users.id',
            email: 'users.email',
            username: 'users.username',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            return { actorUserId, route: null, method: 'POST' }
        },
        writeAuditLogInTransactionService: vi.fn(async function () {
            return { id: 'synthetic-audit-receipt', createdAt: new Date() }
        }),
        async publishCommittedAuditLogService() {},
    }
})

vi.mock('@/server/Queues/mail.queue.ts', function () {
    return {
        enqueuePasswordResetMail: vi.fn(async function () {
            return undefined
        }),
    }
})

vi.mock('@/server/RateLimit/rateLimit.service.ts', function () {
    return {
        enforceRateLimit: vi.fn(async function () {
            return undefined
        }),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

vi.mock('@/server/Auth/enumerationProtection.service.ts', function () {
    return { createEnumerationProtection: enumerationMocks.create }
})

const { requestPasswordResetHandler } =
    await import('@/features/Auth/ForgotPassword/middleware.ts')

const mockedDb = db
const mockedEnqueuePasswordResetMail = enqueuePasswordResetMail as Mock<
    typeof enqueuePasswordResetMail
>
const mockedEnforceRateLimit = enforceRateLimit as Mock<typeof enforceRateLimit>
const mockedLogError = logError as Mock<typeof logError>
const mockedWriteAuditLog = writeAuditLogInTransactionService as Mock<
    typeof writeAuditLogInTransactionService
>
const mockedCreateEnumerationProtection = createEnumerationProtection as Mock<
    typeof createEnumerationProtection
>

describe('requestPasswordResetHandler', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        enumerationMocks.guards.length = 0
        enumerationMocks.state.waitImplementation = async function () {}
        dbMock.state.selectResults = []
        process.env.ORIGIN = 'https://app.test'
    })

    it('meldet unbekannte Benutzer ohne Mailversand zurück', async function () {
        dbMock.state.selectResults = [[]]

        const result = await requestPasswordResetHandler({
            data: { email: ' NIEMAND@EXAMPLE.TEST ' },
        })

        expect(result).toEqual({ success: true })
        expect(mockedEnforceRateLimit).toHaveBeenNthCalledWith(1, {
            limit: 20,
            windowMs: 60 * 60_000,
            scope: 'password-reset-request-ip',
        })
        expect(mockedEnforceRateLimit).toHaveBeenNthCalledWith(2, {
            limit: 5,
            windowMs: 60 * 60_000,
            scope: 'password-reset-request-account',
            identifiers: ['niemand@example.test'],
            includeClientIp: false,
        })
        expect(mockedEnqueuePasswordResetMail).not.toHaveBeenCalled()
        expect(mockedDb.insert).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
        expect(mockedCreateEnumerationProtection).toHaveBeenCalledWith(750)
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
    })

    it('wartet auch vor der Weitergabe eines Rate-Limit-Fehlers', async function () {
        mockedEnforceRateLimit.mockRejectedValueOnce(
            new Error('Zu viele Anfragen'),
        )

        await expect(
            requestPasswordResetHandler({
                data: { email: 'kevin@example.test' },
            }),
        ).rejects.toThrow('Zu viele Anfragen')

        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
        expect(mockedDb.select).not.toHaveBeenCalled()
    })

    it('räumt Reset-Tokens auf, wenn der Mailversand fehlschlägt', async function () {
        const user = {
            id: 'user-1',
            username: 'kevin',
            email: 'kevin@example.test',
        }
        dbMock.state.selectResults = [[user], [user]]
        mockedEnqueuePasswordResetMail.mockRejectedValueOnce(
            new Error('SMTP nicht erreichbar'),
        )

        const result = await requestPasswordResetHandler({
            data: { email: 'kevin@example.test' },
        })

        expect(result).toEqual({ success: true })
        await waitForAssertion(function () {
            expect(mockedDb.delete).toHaveBeenCalledTimes(2)
        })
        expect(mockedLogError).toHaveBeenCalledWith(
            'auth.password_reset.enqueue_failed',
            expect.any(Error),
            { userId: 'user-1' },
        )
        expect(mockedDb.insert).toHaveBeenCalledTimes(1)
        expect(dbMock.state.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                tokenHash: expect.any(String),
                expiresAt: expect.any(Date),
            }),
        )
        expect(mockedEnqueuePasswordResetMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'kevin@example.test',
                username: 'kevin',
                resetLink: expect.stringMatching(
                    /^https:\/\/app\.test\/password-reset#token=/,
                ),
            }),
        )
        await waitForAssertion(function () {
            expect(mockedWriteAuditLog).toHaveBeenCalledTimes(2)
        })
    })

    it('schreibt bei erfolgreichem Reset-Request einen Audit-Log', async function () {
        const user = {
            id: 'user-2',
            username: 'maria',
            email: 'maria@example.test',
        }
        dbMock.state.selectResults = [[user], [user]]

        const result = await requestPasswordResetHandler({
            data: { email: 'maria@example.test' },
        })

        expect(result).toEqual({ success: true })
        await waitForAssertion(function () {
            expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
        })
        await waitForAssertion(function () {
            expect(mockedEnqueuePasswordResetMail).toHaveBeenCalledTimes(1)
        })
        expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.anything(), {
            action: 'auth.password_reset_requested',
            actorUserId: null,
            message: 'Password-Reset für maria wurde angefragt.',
            newValues: { targetUserId: 'user-2' },
            route: null,
            method: 'POST',
        })
    })

    it('keeps the public response and enumeration deadline generic after a mandatory audit failure', async function () {
        const user = {
            id: 'audit-user',
            username: 'known',
            email: 'known@example.test',
        }
        dbMock.state.selectResults = [[user], [user]]
        const error = new Error('Synthetic mandatory audit failure')
        mockedWriteAuditLog.mockRejectedValueOnce(error)
        const result = await requestPasswordResetHandler({
            data: { email: user.email },
        })
        expect(result).toEqual({ success: true })
        await waitForAssertion(function () {
            expect(mockedLogError).toHaveBeenCalledWith(
                'auth.password_reset.request_failed',
                error,
            )
        })
        expect(mockedEnqueuePasswordResetMail).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(result)).not.toContain(error.message)
    })

    it('liefert die uniforme Antwort am Zeitbudget trotz langsamer Mail-Queue', async function () {
        const user = {
            id: 'user-3',
            username: 'slow',
            email: 'slow@example.test',
        }
        let releaseDeadline = noop
        let releaseMailQueue = noop
        enumerationMocks.state.waitImplementation = function () {
            return new Promise<void>(function (resolve) {
                releaseDeadline = resolve
            })
        }
        mockedEnqueuePasswordResetMail.mockImplementationOnce(function () {
            return new Promise<void>(function (resolve) {
                releaseMailQueue = resolve
            })
        })
        dbMock.state.selectResults = [[user], [user]]

        const handlerResult = requestPasswordResetHandler({
            data: { email: user.email },
        })

        await waitForAssertion(function () {
            expect(mockedEnqueuePasswordResetMail).toHaveBeenCalledTimes(1)
        })
        let handlerSettled = false
        void handlerResult.then(function () {
            handlerSettled = true
            return undefined
        })
        await Promise.resolve()
        expect(handlerSettled).toBe(false)

        releaseDeadline()
        await expect(handlerResult).resolves.toEqual({ success: true })
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)

        releaseMailQueue()
        await waitForAssertion(function () {
            expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
        })
    })
})
