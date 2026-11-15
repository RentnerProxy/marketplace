import { afterEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import {
    restoreBunProperties,
    stubBunProperties,
} from '@/tests/shared/bunTestStubs.ts'

const dbMock = (function () {
    const state = {
        selectResults: [] as Array<Array<unknown>>,
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
                return state.selectResults.shift() ?? []
            }),
        }

        return chain
    }

    return {
        db: {
            select: vi.fn(createSelectChain),
        },
        state,
    }
})()

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { conditions, type: 'and' }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { left, right, type: 'eq' }
        }),
    }
})

vi.mock('@/db', function () {
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return {
        twoFactorAuth: { userId: 'twoFactorAuth.userId' },
        users: {
            isDeleted: 'users.isDeleted',
            username: 'users.username',
        },
    }
})

vi.mock('@/server/Auth/Login/get.service.ts', function () {
    return { hasTrustedDevice: vi.fn() }
})

vi.mock('@/server/Auth/Login/session.service.ts', function () {
    return { createAuthenticatedSessionForUser: vi.fn() }
})

vi.mock('@/server/Auth/totp-verification.service.ts', function () {
    return { consumeTotpCodeService: vi.fn() }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return {
        logError: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
    }
})

describe('loginService Enumeration-Schutz', function () {
    afterEach(function () {
        restoreBunProperties()
        vi.clearAllMocks()
        dbMock.state.selectResults = []
    })

    it('wartet beim ersten Request für bekannte und unbekannte Nutzer auf denselben Dummy-Hash', async function () {
        let resolveDummyHash: ((hash: string) => void) | undefined
        const hash = vi.fn(function () {
            return new Promise<string>(function (resolve) {
                resolveDummyHash = resolve
            })
        })
        const verify = vi.fn(async function () {
            return false
        })
        stubBunProperties({ password: { hash, verify } })

        const { loginService } =
            await import('@/server/Auth/Login/login.service.ts')
        dbMock.state.selectResults = [
            [
                {
                    id: 'user-1',
                    username: 'known-user',
                    email: 'known@example.test',
                    passwordHash: 'known-password-hash',
                    isActive: true,
                    isDeleted: false,
                    isTwoFactorEnabled: false,
                },
            ],
            [],
        ]

        const knownLogin = loginService({
            password: 'wrong-password',
            username: 'known-user',
        })
        const unknownLogin = loginService({
            password: 'wrong-password',
            username: 'unknown-user',
        })

        await waitForAssertion(function () {
            expect(dbMock.db.select).toHaveBeenCalledTimes(2)
        })
        expect(verify).not.toHaveBeenCalled()

        resolveDummyHash?.('prepared-dummy-hash')
        await expect(Promise.all([knownLogin, unknownLogin])).resolves.toEqual([
            {
                code: 'INVALID_CREDENTIALS',
                error: 'Ungültige Anmeldedaten.',
                success: false,
            },
            {
                code: 'INVALID_CREDENTIALS',
                error: 'Ungültige Anmeldedaten.',
                success: false,
            },
        ])
        expect(verify).toHaveBeenCalledWith(
            'wrong-password',
            'known-password-hash',
        )
        expect(verify).toHaveBeenCalledWith(
            'wrong-password',
            'prepared-dummy-hash',
        )
    })
})
