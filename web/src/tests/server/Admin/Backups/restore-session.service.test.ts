import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    setSystemTime,
} from 'bun:test'
import {
    consumeRestoreInitiatorSessionBindingService,
    deleteRestoreInitiatorSessionBindingBestEffortService,
    getRestoreInitiatorSessionService,
    replaceRestoredAuthenticationStateService,
    saveRestoreInitiatorSessionBindingService,
} from '@/server/Admin/Backups/restore-session.service.ts'

const restoreSessionKey = 'rentnerproxy-marketplace:backup:restore-session:v1:'

const schemaMock = (function () {
    return {
        passkeyChallenges: 'passkeyChallenges',
        passwordResetTokens: 'passwordResetTokens',
        sessions: {
            id: 'sessions.id',
        },
        trustedDevices: 'trustedDevices',
        users: {
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
        },
    }
})()

const restoreSessionMocks = (function () {
    const state = {
        activeUserRows: [] as Array<Record<string, unknown>>,
        sessionRows: [] as Array<Record<string, unknown>>,
        restoredUserRows: [] as Array<Record<string, unknown>>,
    }
    const beforeReturningUser = vi.fn(async function () {})
    const deleteRows = vi.fn(async function (_table: unknown) {})
    const insertValues = vi.fn(async function (_values: unknown) {})
    const transaction = vi.fn(async function (
        callback: (transaction: unknown) => unknown | Promise<unknown>,
    ) {
        return callback({
            delete: deleteRows,
            insert: vi.fn(function () {
                return { values: insertValues }
            }),
            select: vi.fn(function () {
                return {
                    from: function () {
                        return {
                            where: function () {
                                return {
                                    limit: async function () {
                                        await beforeReturningUser()
                                        return state.restoredUserRows
                                    },
                                }
                            },
                        }
                    },
                }
            }),
        })
    })
    const database = {
        select: vi.fn(function (selection?: unknown) {
            const rows = selection ? state.activeUserRows : state.sessionRows

            return {
                from: function () {
                    return {
                        where: function () {
                            return {
                                limit: async function () {
                                    if (selection) await beforeReturningUser()
                                    return rows
                                },
                            }
                        },
                    }
                },
            }
        }),
        transaction,
    }

    return {
        database,
        beforeReturningUser,
        deleteRows,
        insertValues,
        logError: vi.fn(),
        valkeyDelete: vi.fn(async function () {
            return 1
        }),
        valkeyEval: vi.fn(async function (): Promise<unknown> {
            return null
        }),
        valkeySet: vi.fn(async function (): Promise<string | null> {
            return 'OK'
        }),
        state,
        transaction,
    }
})()

vi.mock('@/db', function () {
    return { db: restoreSessionMocks.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return conditions
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: restoreSessionMocks.logError }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: vi.fn(function () {
            return {
                del: restoreSessionMocks.valkeyDelete,
                eval: restoreSessionMocks.valkeyEval,
                set: restoreSessionMocks.valkeySet,
            }
        }),
    }
})

const SESSION_HASH = 'a'.repeat(64)
const USER_ID = '019f5b07-80e2-7000-8000-000000000010'

function createSession(overrides: Record<string, unknown> = {}) {
    return {
        id: SESSION_HASH,
        userId: USER_ID,
        ip: '127.0.0.1',
        location: 'Zürich',
        device: 'Desktop',
        browser: 'Firefox',
        expiresAt: new Date('2026-08-11T12:15:00.000Z'),
        ...overrides,
    }
}

describe('Restore-Sitzungserhalt', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        restoreSessionMocks.state.activeUserRows = [{ id: USER_ID }]
        restoreSessionMocks.state.sessionRows = []
        restoreSessionMocks.state.restoredUserRows = []
    })

    afterEach(function () {
        vi.useRealTimers()
    })

    it('bindet den Session-Hash bis höchstens zum Sitzungsablauf an den v2-Run', async function () {
        const expiresAt = new Date('2026-08-12T12:00:00.000Z')

        await expect(
            saveRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
                SESSION_HASH,
                expiresAt,
            ),
        ).resolves.toBeUndefined()

        expect(restoreSessionMocks.valkeySet).toHaveBeenCalledWith(
            restoreSessionKey + '019f5b07-80e2-7000-8000-000000000001',
            SESSION_HASH,
            'PX',
            15 * 60_000,
            'NX',
        )
    })

    it('plant mit einer abgelaufenen Sitzung keinen Restore ein', async function () {
        await expect(
            saveRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
                SESSION_HASH,
                new Date('2026-08-11T11:59:59.999Z'),
            ),
        ).rejects.toThrow('abgelaufene Sitzung')

        expect(restoreSessionMocks.valkeySet).not.toHaveBeenCalled()
    })

    it('überschreibt keine bereits vorhandene Restore-Sitzungsbindung', async function () {
        restoreSessionMocks.valkeySet.mockResolvedValueOnce(null)

        await expect(
            saveRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
                SESSION_HASH,
                new Date('2026-08-12T12:00:00.000Z'),
            ),
        ).rejects.toThrow('nicht eindeutig gebunden')
    })

    it('konsumiert die Restore-Sitzungsbindung atomar genau einmal', async function () {
        restoreSessionMocks.valkeyEval.mockResolvedValueOnce(SESSION_HASH)

        await expect(
            consumeRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
            ),
        ).resolves.toBe(SESSION_HASH)

        expect(restoreSessionMocks.valkeyEval).toHaveBeenCalledWith(
            expect.stringContaining("server.call('del', KEYS[1])"),
            1,
            restoreSessionKey + '019f5b07-80e2-7000-8000-000000000001',
        )
    })

    it('fällt bei einem Valkey-Lesefehler sicher auf vollständigen Logout zurück', async function () {
        const valkeyError = new Error('Valkey nicht verfügbar')
        restoreSessionMocks.valkeyEval.mockRejectedValueOnce(valkeyError)

        await expect(
            consumeRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
            ),
        ).resolves.toBeNull()

        expect(restoreSessionMocks.logError).toHaveBeenCalledWith(
            'backup.restore.session_binding_read_failed',
            valkeyError,
            { runId: '019f5b07-80e2-7000-8000-000000000001' },
        )
    })

    it('verwirft eine beschädigte konsumierte Sitzungsbindung vor dem Restore', async function () {
        restoreSessionMocks.valkeyEval.mockResolvedValueOnce('kein-hash')

        await expect(
            consumeRestoreInitiatorSessionBindingService(
                '019f5b07-80e2-7000-8000-000000000001',
            ),
        ).rejects.toThrow('ungültig oder nicht unterstützt')
    })

    it('räumt eine nicht mehr benötigte Sitzungsbindung bestmöglich auf', async function () {
        await expect(
            deleteRestoreInitiatorSessionBindingBestEffortService(
                '019f5b07-80e2-7000-8000-000000000001',
            ),
        ).resolves.toBeUndefined()

        expect(restoreSessionMocks.valkeyDelete).toHaveBeenCalledWith(
            restoreSessionKey + '019f5b07-80e2-7000-8000-000000000001',
        )
    })

    it('lädt ausschließlich die aktive Sitzung des auslösenden Benutzers', async function () {
        const session = createSession()
        restoreSessionMocks.state.sessionRows = [session]

        await expect(
            getRestoreInitiatorSessionService(USER_ID, SESSION_HASH),
        ).resolves.toEqual(session)
    })

    it('bricht bei einer Sitzung eines fremden Benutzers vor dem Restore ab', async function () {
        restoreSessionMocks.state.sessionRows = [
            createSession({
                userId: '019f5b07-80e2-7000-8000-000000000099',
            }),
        ]

        await expect(
            getRestoreInitiatorSessionService(USER_ID, SESSION_HASH),
        ).rejects.toThrow('gehört nicht zum auslösenden Benutzer')
    })

    it('übernimmt keine bereits abgelaufene Sitzung', async function () {
        restoreSessionMocks.state.sessionRows = [
            createSession({ expiresAt: new Date('2026-08-11T11:59:59.000Z') }),
        ]

        await expect(
            getRestoreInitiatorSessionService(USER_ID, SESSION_HASH),
        ).resolves.toBeNull()
    })

    it('übernimmt keine Sitzung eines inzwischen gesperrten Benutzers', async function () {
        restoreSessionMocks.state.sessionRows = [createSession()]
        restoreSessionMocks.state.activeUserRows = []

        await expect(
            getRestoreInitiatorSessionService(USER_ID, SESSION_HASH),
        ).resolves.toBeNull()
    })

    it('widerruft alle Auth-Zustände und setzt exakt die initiierende Sitzung wieder ein', async function () {
        const session = createSession()
        restoreSessionMocks.state.restoredUserRows = [{ id: USER_ID }]

        await expect(
            replaceRestoredAuthenticationStateService(session),
        ).resolves.toBe(true)

        expect(
            restoreSessionMocks.deleteRows.mock.calls.map(([table]) => table),
        ).toEqual([
            schemaMock.passkeyChallenges,
            schemaMock.passwordResetTokens,
            schemaMock.trustedDevices,
            schemaMock.sessions,
        ])
        expect(restoreSessionMocks.insertValues).toHaveBeenCalledTimes(1)
        expect(restoreSessionMocks.insertValues).toHaveBeenCalledWith(session)
    })

    it('lässt den Browser ausgeloggt, wenn der Benutzer im Restore-Stand nicht aktiv vorhanden ist', async function () {
        const session = createSession()

        await expect(
            replaceRestoredAuthenticationStateService(session),
        ).resolves.toBe(false)

        expect(restoreSessionMocks.deleteRows).toHaveBeenCalledTimes(4)
        expect(restoreSessionMocks.insertValues).not.toHaveBeenCalled()
    })

    it('retains only the existing minute of a restore binding instead of resetting idle time', async function () {
        await saveRestoreInitiatorSessionBindingService(
            '019f5b07-80e2-7000-8000-000000000001',
            SESSION_HASH,
            new Date(Date.now() + 60_000),
        )
        expect(restoreSessionMocks.valkeySet).toHaveBeenCalledWith(
            expect.any(String),
            SESSION_HASH,
            'PX',
            60_000,
            'NX',
        )
    })

    it('rejects a session that expires during the active-user read', async function () {
        restoreSessionMocks.state.sessionRows = [createSession()]
        restoreSessionMocks.beforeReturningUser.mockImplementationOnce(
            async function () {
                setSystemTime(new Date('2026-08-11T12:15:00.000Z'))
            },
        )
        expect(
            await getRestoreInitiatorSessionService(USER_ID, SESSION_HASH),
        ).toBeNull()
    })

    it('does not reinsert an expired session after waiting for the restored user', async function () {
        restoreSessionMocks.state.restoredUserRows = [{ id: USER_ID }]
        restoreSessionMocks.beforeReturningUser.mockImplementationOnce(
            async function () {
                setSystemTime(new Date('2026-08-11T12:15:00.000Z'))
            },
        )
        expect(
            await replaceRestoredAuthenticationStateService(createSession()),
        ).toBe(false)
        expect(restoreSessionMocks.insertValues).not.toHaveBeenCalled()
        expect(restoreSessionMocks.deleteRows).toHaveBeenCalledTimes(4)
    })
})
