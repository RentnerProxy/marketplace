import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreBunProperties,
    stubBunProperties,
} from '@/tests/shared/bunTestStubs.ts'
import { consumeTotpCodeService } from '@/server/Auth/totp-verification.service.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'

function createSession() {
    return {
        id: 'user-1',
        sessionHash: 'a'.repeat(64),
        username: 'kevin',
        email: 'kevin@example.test',
        isActive: true,
        isDeleted: false,
        expiresAt: new Date(Date.now() + 300_000),
    }
}

const passwordVerifyMock = (function () {
    return vi.fn(async function () {
        return true
    })
})()

const schemaMock = (function () {
    return {
        twoFactorAuth: {
            id: 'twoFactorAuth.id',
            secret: 'twoFactorAuth.secret',
            userId: 'twoFactorAuth.userId',
            verified: 'twoFactorAuth.verified',
        },
        users: {
            email: 'users.email',
            id: 'users.id',
            isActive: 'users.isActive',
            isDeleted: 'users.isDeleted',
            isTwoFactorEnabled: 'users.isTwoFactorEnabled',
            passwordHash: 'users.passwordHash',
            username: 'users.username',
        },
    }
})()

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

const serviceMocks = (function () {
    return {
        enforceRateLimit: vi.fn(async function () {
            return undefined
        }),
        getActiveCurrentSessionUser: vi.fn(async function () {
            return createSession()
        }),
        createReauthenticationProofService: vi.fn(async function (
            user: { id: string },
            _factorId: string | null,
            sessionHash: string,
        ) {
            return {
                userId: user.id,
                sessionHash,
                credentialVersion: 'c'.repeat(64),
                expiresAt: Date.now() + 60_000,
            }
        }),
        consumeTotpCodeService: vi.fn(async function () {
            return true
        }),
        logWarn: vi.fn(function () {
            return undefined
        }),
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
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getActiveCurrentSessionUser: serviceMocks.getActiveCurrentSessionUser,
    }
})

vi.mock('@/server/Auth/reauthentication-proof.service.ts', function () {
    return {
        createReauthenticationProofService:
            serviceMocks.createReauthenticationProofService,
    }
})

vi.mock('@/server/RateLimit/rateLimit.service.ts', function () {
    return {
        enforceRateLimit: serviceMocks.enforceRateLimit,
        RateLimitError: class extends Error {},
    }
})

vi.mock('@/server/Auth/totp-verification.service.ts', function () {
    return { consumeTotpCodeService: serviceMocks.consumeTotpCodeService }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logWarn: serviceMocks.logWarn }
})

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

const mockedEnforceRateLimit = enforceRateLimit as Mock<typeof enforceRateLimit>
const mockedGetActiveCurrentSessionUser = getActiveCurrentSessionUser as Mock<
    typeof getActiveCurrentSessionUser
>
const mockedConsumeTotpCode = consumeTotpCodeService as Mock<
    typeof consumeTotpCodeService
>
const mockedLogWarn = logWarn as Mock<typeof logWarn>

function createUser(isTwoFactorEnabled: boolean) {
    return {
        id: 'user-1',
        username: 'kevin',
        email: 'kevin@example.test',
        passwordHash: 'password-hash',
        isTwoFactorEnabled,
    }
}

describe('reauthenticateCurrentUserService', function () {
    beforeEach(function () {
        stubBunProperties({ password: { verify: passwordVerifyMock } })
        vi.clearAllMocks()
        dbMock.state.selectResults = []
        mockedGetActiveCurrentSessionUser.mockResolvedValue(createSession())
        passwordVerifyMock.mockResolvedValue(true)
        mockedConsumeTotpCode.mockResolvedValue(true)
    })

    afterEach(function () {
        restoreBunProperties()
    })

    it('akzeptiert für Legacy-Konten auch ein bestehendes kurzes Passwort', async function () {
        dbMock.state.selectResults = [[createUser(false)]]

        const result = await reauthenticateCurrentUserService({
            method: 'password',
            credential: '1',
        })

        expect(result).toMatchObject({ success: true })
        expect(passwordVerifyMock).toHaveBeenCalledWith('1', 'password-hash')
        expect(
            serviceMocks.createReauthenticationProofService,
        ).toHaveBeenCalledWith(createUser(false), null, 'a'.repeat(64))
        expect(result).toMatchObject({
            proof: {
                userId: 'user-1',
                sessionHash: 'a'.repeat(64),
                credentialVersion: 'c'.repeat(64),
            },
        })
        expect(JSON.stringify(result)).not.toContain('password-hash')
        expect(mockedEnforceRateLimit).toHaveBeenCalledWith(
            expect.objectContaining({
                scope: 'current-user-reauthentication-account',
                identifiers: ['user-1'],
                includeClientIp: false,
            }),
        )
    })

    it('fordert bei aktivierter 2FA ausschließlich einen aktuellen TOTP-Code', async function () {
        dbMock.state.selectResults = [
            [createUser(true)],
            [
                {
                    id: 'factor-1',
                    userId: 'user-1',
                    secret: 'encrypted-secret',
                    verified: true,
                },
            ],
        ]

        const result = await reauthenticateCurrentUserService({
            method: 'totp',
            credential: '123456',
        })

        expect(result).toMatchObject({ success: true })
        expect(mockedConsumeTotpCode).toHaveBeenCalledWith(
            {
                id: 'factor-1',
                userId: 'user-1',
                secret: 'encrypted-secret',
                verified: true,
            },
            '123456',
        )
        expect(passwordVerifyMock).not.toHaveBeenCalled()
        expect(
            serviceMocks.createReauthenticationProofService,
        ).toHaveBeenCalledWith(createUser(true), 'factor-1', 'a'.repeat(64))
    })

    it('lehnt eine falsche Faktorart mit derselben generischen Meldung ab', async function () {
        dbMock.state.selectResults = [[createUser(true)]]
        const wrongMethod = await reauthenticateCurrentUserService({
            method: 'password',
            credential: 'correct-password',
        })

        dbMock.state.selectResults = [[createUser(false)]]
        passwordVerifyMock.mockResolvedValue(false)
        const wrongPassword = await reauthenticateCurrentUserService({
            method: 'password',
            credential: 'wrong-password',
        })

        expect(wrongMethod).toEqual(wrongPassword)
        expect(wrongMethod).toMatchObject({ success: false })
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'credential_method_mismatch'],
            ['reauthentication', 'invalid_credentials'],
        ])
    })

    it('lehnt eine inkonsistente 2FA-Konfiguration ohne Secret im Log ab', async function () {
        dbMock.state.selectResults = [[createUser(true)], []]

        const result = await reauthenticateCurrentUserService({
            method: 'totp',
            credential: '123456',
        })

        expect(result).toMatchObject({ success: false })
        expect(mockedLogWarn).toHaveBeenCalledWith(
            'auth.reauthentication.two_factor_configuration_invalid',
            { userId: 'user-1' },
        )
        expect(JSON.stringify(mockedLogWarn.mock.calls)).not.toContain('123456')
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('limitiert auch Anfragen ohne aktive Sitzung vor dem Abbruch', async function () {
        mockedGetActiveCurrentSessionUser.mockResolvedValue(null)

        const result = await reauthenticateCurrentUserService({
            method: 'password',
            credential: 'not-logged',
        })

        expect(result).toEqual({
            success: false,
            error: 'Du bist nicht angemeldet.',
        })
        expect(mockedEnforceRateLimit).toHaveBeenCalledWith(
            expect.objectContaining({
                scope: 'current-user-reauthentication-ip',
            }),
        )
        expect(mockedEnforceRateLimit).toHaveBeenCalledTimes(1)
        expect(dbMock.db.select).not.toHaveBeenCalled()
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'invalid_session'],
        ])
    })

    it.each(['replayed', 'storage-failed'])(
        'rejects TOTP when consumption is %s',
        async function (reason) {
            dbMock.state.selectResults = [
                [createUser(true)],
                [
                    {
                        id: 'factor-1',
                        userId: 'user-1',
                        secret: 'encrypted-secret',
                        verified: true,
                    },
                ],
            ]
            if (reason === 'replayed') {
                mockedConsumeTotpCode.mockResolvedValueOnce(false)
            } else {
                mockedConsumeTotpCode.mockRejectedValueOnce(
                    new Error('synthetic database failure'),
                )
            }
            const result = await reauthenticateCurrentUserService({
                method: 'totp',
                credential: '123456',
            })
            expect(result).toMatchObject({ success: false })
            expect(result).not.toHaveProperty('currentUser')
            expect(mockedRejection.mock.calls).toEqual(
                reason === 'replayed'
                    ? [['reauthentication', 'invalid_two_factor']]
                    : [],
            )
            expect(passwordVerifyMock).not.toHaveBeenCalled()
            expect(
                serviceMocks.createReauthenticationProofService,
            ).not.toHaveBeenCalled()
        },
    )
    it.each(['ip', 'account'] as const)(
        'records a confirmed %s quota once and preserves the original rejection',
        async function (stage) {
            const quota = new RateLimitError(15)
            if (stage === 'account')
                mockedEnforceRateLimit.mockResolvedValueOnce(undefined)
            mockedEnforceRateLimit.mockRejectedValueOnce(quota)
            await expect(
                reauthenticateCurrentUserService({
                    method: 'password',
                    credential: 'private',
                }),
            ).rejects.toBe(quota)
            expect(mockedRejection.mock.calls).toEqual([
                ['reauthentication', 'rate_limited'],
            ])
            expect(passwordVerifyMock).not.toHaveBeenCalled()
        },
    )

    it('does not classify quota storage errors as rejected credentials', async function () {
        const storage = new Error('synthetic quota storage failure')
        mockedEnforceRateLimit.mockRejectedValueOnce(storage)
        await expect(
            reauthenticateCurrentUserService({
                method: 'password',
                credential: 'private',
            }),
        ).rejects.toBe(storage)
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('does not classify a password verifier exception as bad credentials', async function () {
        dbMock.state.selectResults = [[createUser(false)]]
        passwordVerifyMock.mockRejectedValueOnce(
            new Error('synthetic verifier failure'),
        )
        expect(
            (
                await reauthenticateCurrentUserService({
                    method: 'password',
                    credential: 'private',
                })
            ).success,
        ).toBe(false)
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('records a missing current account as an invalid session', async function () {
        dbMock.state.selectResults = [[]]
        expect(
            (
                await reauthenticateCurrentUserService({
                    method: 'password',
                    credential: 'private',
                })
            ).success,
        ).toBe(false)
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'invalid_session'],
        ])
    })

    it('does not record a successful password verification as a denial', async function () {
        dbMock.state.selectResults = [[createUser(false)]]
        expect(
            (
                await reauthenticateCurrentUserService({
                    method: 'password',
                    credential: 'private',
                })
            ).success,
        ).toBe(true)
        expect(mockedRejection).not.toHaveBeenCalled()
    })
})
