import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { getClientRequestMeta } from '@/lib/Request/clientRequestMeta.ts'
import { enqueueFailedLoginAlertMail } from '@/server/Queues/mail.queue.ts'
import { logWarnError } from '@/server/Logging/logger.ts'
import { notifyExistingUserAboutFailedLogin } from '@/server/Auth/Login/failedLoginAlert.service.ts'

function noop() {}

const dbMock = (function () {
    const state = {
        rows: [] as Array<unknown>,
        queryError: null as unknown,
    }

    function createSelectChain() {
        const chain = {
            from: vi.fn(function () {
                return chain
            }),
            where: vi.fn(function () {
                return chain
            }),
            limit: vi.fn(async function () {
                if (state.queryError !== null) {
                    throw state.queryError
                }
                return state.rows
            }),
        }

        return chain
    }

    return {
        db: { select: vi.fn(createSelectChain) },
        state,
    }
})()

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(),
        eq: vi.fn(),
    }
})

vi.mock('@/db', function () {
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return {
        users: {
            email: 'users.email',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
            username: 'users.username',
        },
    }
})

vi.mock('@/lib/Request/clientRequestMeta.ts', function () {
    return { getClientRequestMeta: vi.fn() }
})

vi.mock('@/server/Queues/mail.queue.ts', function () {
    return { enqueueFailedLoginAlertMail: vi.fn() }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logWarnError: vi.fn() }
})

const mockedLogWarnError = logWarnError as Mock<typeof logWarnError>
const mockedGetClientRequestMeta = getClientRequestMeta as Mock<
    typeof getClientRequestMeta
>
const mockedEnqueueFailedLoginAlertMail = enqueueFailedLoginAlertMail as Mock<
    typeof enqueueFailedLoginAlertMail
>
const requestMeta = {
    browser: 'Chrome',
    device: 'Windows',
    ip: '203.0.113.10',
    location: 'Berlin, Deutschland',
}

describe('Failed-Login-Alert Enumeration-Schutz', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        dbMock.state.rows = []
        dbMock.state.queryError = null
        mockedGetClientRequestMeta.mockResolvedValue(requestMeta)
        mockedEnqueueFailedLoginAlertMail.mockResolvedValue(undefined)
    })

    it('ermittelt Request-Metadaten auch für unbekannte Benutzernamen', async function () {
        await notifyExistingUserAboutFailedLogin('unknown-user')

        expect(mockedGetClientRequestMeta).toHaveBeenCalledTimes(1)
        expect(mockedEnqueueFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('plant nur für einen vorhandenen aktiven Benutzer eine Warnung ein', async function () {
        dbMock.state.rows = [{ email: 'kevin@example.test', username: 'kevin' }]

        await notifyExistingUserAboutFailedLogin('kevin')

        expect(mockedGetClientRequestMeta).toHaveBeenCalledTimes(1)
        expect(mockedEnqueueFailedLoginAlertMail).toHaveBeenCalledWith({
            ...requestMeta,
            attemptedAt: expect.any(String),
            mapsLink:
                'https://www.google.com/maps/search/?api=1&query=Berlin%2C%20Deutschland',
            to: 'kevin@example.test',
            username: 'kevin',
        })
    })

    it('koppelt die Lockout-Antwort nicht an eine langsame Mail-Queue', async function () {
        let releaseMailQueue = noop
        dbMock.state.rows = [{ email: 'slow@example.test', username: 'slow' }]
        mockedEnqueueFailedLoginAlertMail.mockImplementationOnce(function () {
            return new Promise<void>(function (resolve) {
                releaseMailQueue = resolve
            })
        })

        await expect(
            notifyExistingUserAboutFailedLogin('slow'),
        ).resolves.toBeUndefined()
        expect(mockedEnqueueFailedLoginAlertMail).toHaveBeenCalledTimes(1)

        releaseMailQueue()
    })

    it('übergibt Lookup-Fehler unverändert ohne personenbezogenen Kontext an den Warnlogger', async function () {
        const error = new Error(
            'select user where username = sensitive-user; params: victim@example.test',
        )
        dbMock.state.queryError = error

        await expect(
            notifyExistingUserAboutFailedLogin('sensitive-user'),
        ).resolves.toBeUndefined()

        expect(mockedLogWarnError).toHaveBeenCalledTimes(1)
        expect(mockedLogWarnError).toHaveBeenCalledWith(
            'auth.failed_login_alert.user_lookup_unavailable',
            error,
        )
        expect(mockedEnqueueFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('serialisiert fremde Fehlerwerte bei der Request-Metadatenauflösung nicht selbst', async function () {
        const toString = vi.fn(function () {
            throw new Error(
                'Ein fremder Fehlerwert darf nicht formatiert werden.',
            )
        })
        const error = { toString }
        mockedGetClientRequestMeta.mockRejectedValueOnce(error)

        await expect(
            notifyExistingUserAboutFailedLogin('unknown-user'),
        ).resolves.toBeUndefined()

        expect(mockedLogWarnError).toHaveBeenCalledTimes(1)
        expect(mockedLogWarnError).toHaveBeenCalledWith(
            'auth.failed_login_alert.user_lookup_unavailable',
            error,
        )
        expect(toString).not.toHaveBeenCalled()
        expect(mockedEnqueueFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('behandelt einen späteren Queuefehler ohne die bereits abgeschlossene Lockout-Antwort zu ändern', async function () {
        let rejectMailQueue: (error: unknown) => void = noop
        const error = new Error(
            'SMTP rejected victim@example.test token=secret',
        )
        dbMock.state.rows = [
            { email: 'victim@example.test', username: 'victim' },
        ]
        mockedEnqueueFailedLoginAlertMail.mockImplementationOnce(function () {
            return new Promise<void>(function (_resolve, reject) {
                rejectMailQueue = reject
            })
        })

        await expect(
            notifyExistingUserAboutFailedLogin('victim'),
        ).resolves.toBeUndefined()
        expect(mockedLogWarnError).not.toHaveBeenCalled()

        rejectMailQueue(error)
        await Promise.resolve()

        expect(mockedLogWarnError).toHaveBeenCalledTimes(1)
        expect(mockedLogWarnError).toHaveBeenCalledWith(
            'auth.failed_login_alert.unavailable',
            error,
        )
    })

    it('gibt primitive Queuefehler unverändert an die zentrale Klassifikation weiter', async function () {
        const error = 'seed=private-totp-seed'
        dbMock.state.rows = [
            { email: 'victim@example.test', username: 'victim' },
        ]
        mockedEnqueueFailedLoginAlertMail.mockRejectedValueOnce(error)

        await expect(
            notifyExistingUserAboutFailedLogin('victim'),
        ).resolves.toBeUndefined()

        expect(mockedLogWarnError).toHaveBeenCalledTimes(1)
        expect(mockedLogWarnError).toHaveBeenCalledWith(
            'auth.failed_login_alert.unavailable',
            error,
        )
    })
})
