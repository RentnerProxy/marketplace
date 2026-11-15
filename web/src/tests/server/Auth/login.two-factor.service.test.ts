import type { Mock } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreBunProperties,
    stubBunProperties,
} from '@/tests/shared/bunTestStubs.ts'
import { hasTrustedDevice } from '@/server/Auth/Login/get.service.ts'
import { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import { loginService } from '@/server/Auth/Login/login.service.ts'
import { consumeTotpCodeService } from '@/server/Auth/totp-verification.service.ts'
import { claimLoginRecoveryAttemptService } from '@/server/Auth/Login/recovery.service.ts'
import type { LoginRecoveryAttempt } from '@/server/Auth/Types/login-recovery.types.ts'

const bunPasswordState = (function () {
    const password = {
        hash: vi.fn(async function (value: string) {
            return `hash:${value}`
        }),
        verify: vi.fn(async function (value: string, hash: string) {
            return hash === `hash:${value}`
        }),
    }

    if (typeof Bun === 'undefined') {
        stubBunProperties({ password })
        return {
            originalPassword: null,
            usesNativeBun: false as const,
        }
    }

    const originalPassword = Bun.password

    if (!Reflect.set(Bun, 'password', password)) {
        throw new Error(
            'Bun.password konnte für den Login-Test nicht ersetzt werden.',
        )
    }

    return {
        originalPassword,
        usesNativeBun: true as const,
    }
})()

afterAll(function () {
    if (!bunPasswordState.usesNativeBun) {
        restoreBunProperties()
        return
    }

    if (!Reflect.set(Bun, 'password', bunPasswordState.originalPassword)) {
        throw new Error(
            'Bun.password konnte nach dem Login-Test nicht wiederhergestellt werden.',
        )
    }
})

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
        state,
        db: {
            select: vi.fn(createSelectChain),
        },
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
    return {
        twoFactorAuth: {
            userId: 'twoFactorAuth.userId',
        },
        users: {
            username: 'users.username',
            isDeleted: 'users.isDeleted',
        },
    }
})

vi.mock('@/server/Auth/Login/get.service.ts', function () {
    return {
        hasTrustedDevice: vi.fn(async function () {
            return false
        }),
    }
})

vi.mock('@/server/Auth/Login/session.service.ts', function () {
    return {
        createAuthenticatedSessionForUser: vi.fn(async function () {
            return { success: true as const, redirectTo: '/dashboard' }
        }),
    }
})

vi.mock('@/server/Auth/totp-verification.service.ts', function () {
    return {
        consumeTotpCodeService: vi.fn(async function () {
            return true
        }),
    }
})

vi.mock('@/server/Auth/Login/recovery.service.ts', function () {
    return {
        claimLoginRecoveryAttemptService: vi.fn(async function () {
            return true
        }),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return {
        logError: vi.fn(),
        logWarn: vi.fn(function () {
            return undefined
        }),
    }
})

const mockedConsumeTotpCode = consumeTotpCodeService as Mock<
    typeof consumeTotpCodeService
>
const mockedHasTrustedDevice = hasTrustedDevice as Mock<typeof hasTrustedDevice>
const mockedClaimRecoveryAttempt = claimLoginRecoveryAttemptService as Mock<
    typeof claimLoginRecoveryAttemptService
>
const mockedCreateAuthenticatedSessionForUser =
    createAuthenticatedSessionForUser as Mock<
        typeof createAuthenticatedSessionForUser
    >

const validPassword = 'correct-password'
const passwordHash = `hash:${validPassword}`

function createTwoFactorUser() {
    return {
        id: 'user-1',
        username: 'kevin',
        email: 'kevin@example.test',
        passwordHash,
        isActive: true,
        isDeleted: false,
        isTwoFactorEnabled: true,
    }
}

function recoveryAttemptFixture(): LoginRecoveryAttempt {
    return {
        grantTokenHash: 'a'.repeat(64),
        attemptId: Buffer.alloc(32, 7).toString('base64url'),
    }
}

function installVerifiedFactor() {
    const user = createTwoFactorUser()
    const factor = {
        id: 'factor-1',
        userId: user.id,
        secret: 'encrypted-secret',
        verified: true,
    }
    dbMock.state.selectResults = [[user], [factor]]
    return { user, factor }
}

describe('loginService 2FA-Invarianten', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        mockedConsumeTotpCode.mockResolvedValue(true)
        mockedHasTrustedDevice.mockResolvedValue(false)
        mockedClaimRecoveryAttempt.mockResolvedValue(true)
        dbMock.state.selectResults = []
    })

    it('blockiert den Login, wenn das 2FA-Flag ohne Faktor gesetzt ist', async function () {
        dbMock.state.selectResults = [[createTwoFactorUser()], []]

        const result = await loginService({
            username: 'kevin',
            password: validPassword,
        })

        expect(result).toEqual({
            success: false,
            code: 'TWO_FACTOR_CONFIGURATION_INVALID',
            error: 'Die Zwei-Faktor-Authentifizierung ist nicht vollständig eingerichtet. Bitte wende dich an einen Administrator.',
        })
        expect(mockedHasTrustedDevice).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('blockiert den Login, wenn der vorhandene Faktor unverifiziert ist', async function () {
        dbMock.state.selectResults = [
            [createTwoFactorUser()],
            [{ id: 'factor-1', secret: 'encrypted-secret', verified: false }],
        ]

        const result = await loginService({
            username: 'kevin',
            password: validPassword,
            twoFactorCode: '123456',
        })

        expect(result).toMatchObject({
            success: false,
            code: 'TWO_FACTOR_CONFIGURATION_INVALID',
        })
        expect(mockedHasTrustedDevice).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('fordert bei einem verifizierten Faktor weiterhin den 2FA-Code an', async function () {
        dbMock.state.selectResults = [
            [createTwoFactorUser()],
            [{ id: 'factor-1', secret: 'encrypted-secret', verified: true }],
        ]

        const result = await loginService({
            username: 'kevin',
            password: validPassword,
        })

        expect(result).toEqual({
            success: false,
            code: 'TWO_FACTOR_REQUIRED',
            requiresTwoFactor: true,
            error: 'Bitte gib deinen 2FA-Code ein.',
        })
        expect(mockedHasTrustedDevice).toHaveBeenCalledWith('user-1')
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('does not issue sessions or trusted devices when a TOTP was already consumed', async function () {
        const factor = {
            id: 'factor-1',
            userId: 'user-1',
            secret: 'encrypted-secret',
            verified: true,
        }
        dbMock.state.selectResults = [[createTwoFactorUser()], [factor]]
        mockedConsumeTotpCode.mockResolvedValueOnce(false)
        const result = await loginService({
            username: 'kevin',
            password: validPassword,
            twoFactorCode: '123456',
            trustThisDevice: true,
        })
        expect(result).toMatchObject({
            success: false,
            code: 'INVALID_TWO_FACTOR',
        })
        expect(mockedConsumeTotpCode).toHaveBeenCalledWith(factor, '123456')
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('waits for committed TOTP consumption before issuing a session', async function () {
        const factor = {
            id: 'factor-1',
            userId: 'user-1',
            secret: 'encrypted-secret',
            verified: true,
        }
        dbMock.state.selectResults = [[createTwoFactorUser()], [factor]]
        let allowConsumption: ((value: boolean) => void) | undefined
        mockedConsumeTotpCode.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    allowConsumption = resolve
                }),
        )
        const login = loginService({
            username: 'kevin',
            password: validPassword,
            twoFactorCode: '123456',
            trustThisDevice: true,
        })
        await waitForAssertion(() => expect(allowConsumption).toBeDefined())
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
        allowConsumption?.(true)
        expect(await login).toMatchObject({ success: true })
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledWith({
            user: createTwoFactorUser(),
            proof: {
                kind: 'password',
                trustThisDevice: true,
                factorId: 'factor-1',
            },
            auditAction: 'auth.login',
            auditMessage: 'Benutzer kevin hat sich angemeldet.',
        })
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledTimes(1)
    })

    it('passes a password snapshot without granting device trust when MFA is disabled', async function () {
        const user = { ...createTwoFactorUser(), isTwoFactorEnabled: false }
        dbMock.state.selectResults = [[user], []]
        expect(
            await loginService({
                username: 'kevin',
                password: validPassword,
                trustThisDevice: true,
            }),
        ).toMatchObject({ success: true })
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledWith({
            user,
            proof: { kind: 'password', trustThisDevice: false, factorId: null },
            auditAction: 'auth.login',
            auditMessage: 'Benutzer kevin hat sich angemeldet.',
        })
    })

    it('does not renew a trusted device merely by presenting its existing cookie', async function () {
        const user = createTwoFactorUser()
        dbMock.state.selectResults = [
            [user],
            [
                {
                    id: 'factor-1',
                    userId: user.id,
                    secret: 'encrypted-secret',
                    verified: true,
                },
            ],
        ]
        mockedHasTrustedDevice.mockResolvedValueOnce(true)
        expect(
            await loginService({
                username: 'kevin',
                password: validPassword,
                trustThisDevice: true,
            }),
        ).toMatchObject({ success: true })
        expect(mockedConsumeTotpCode).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledWith({
            user,
            proof: {
                kind: 'password',
                trustThisDevice: false,
                factorId: 'factor-1',
            },
            auditAction: 'auth.login',
            auditMessage: 'Benutzer kevin hat sich angemeldet.',
        })
    })

    it('returns a failed login when finalization rejects the verified snapshot', async function () {
        dbMock.state.selectResults = [
            [{ ...createTwoFactorUser(), isTwoFactorEnabled: false }],
            [],
        ]
        mockedCreateAuthenticatedSessionForUser.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        expect(
            await loginService({ username: 'kevin', password: validPassword }),
        ).toEqual({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
    })

    it('catches an asynchronous finalization failure before returning to the handler', async function () {
        dbMock.state.selectResults = [
            [{ ...createTwoFactorUser(), isTwoFactorEnabled: false }],
            [],
        ]
        mockedCreateAuthenticatedSessionForUser.mockRejectedValueOnce(
            new Error('synthetic transaction failure'),
        )
        expect(
            await loginService({ username: 'kevin', password: validPassword }),
        ).toMatchObject({ success: false, code: 'INTERNAL_ERROR' })
    })

    it('does not authenticate when storing the consumed step fails', async function () {
        dbMock.state.selectResults = [
            [createTwoFactorUser()],
            [
                {
                    id: 'factor-1',
                    userId: 'user-1',
                    secret: 'encrypted-secret',
                    verified: true,
                },
            ],
        ]
        mockedConsumeTotpCode.mockRejectedValueOnce(
            new Error('synthetic database failure'),
        )
        expect(
            await loginService({
                username: 'kevin',
                password: validPassword,
                twoFactorCode: '123456',
                trustThisDevice: true,
            }),
        ).toMatchObject({ success: false, code: 'INTERNAL_ERROR' })
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })
    it('does not claim recovery for a normal login without a reserved attempt', async function () {
        installVerifiedFactor()
        expect(
            await loginService({
                username: 'kevin',
                password: validPassword,
                twoFactorCode: '123456',
            }),
        ).toMatchObject({ success: true })
        expect(mockedConsumeTotpCode).toHaveBeenCalledTimes(1)
        expect(mockedClaimRecoveryAttempt).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledTimes(1)
    })

    it.each([
        { failure: 'incorrect password', code: 'INVALID_CREDENTIALS' },
        { failure: 'unknown user', code: 'INVALID_CREDENTIALS' },
        { failure: 'inactive user', code: 'USER_INACTIVE' },
        {
            failure: 'inconsistent MFA',
            code: 'TWO_FACTOR_CONFIGURATION_INVALID',
        },
        { failure: 'missing TOTP', code: 'TWO_FACTOR_REQUIRED' },
        { failure: 'incorrect TOTP', code: 'INVALID_TWO_FACTOR' },
    ])(
        'does not claim a recovery attempt or issue credentials after $failure',
        async function ({ failure, code }) {
            const { user } = installVerifiedFactor()
            if (failure === 'unknown user') dbMock.state.selectResults = [[]]
            if (failure === 'inactive user') user.isActive = false
            if (failure === 'inconsistent MFA')
                dbMock.state.selectResults = [[user], []]
            if (failure === 'incorrect TOTP')
                mockedConsumeTotpCode.mockResolvedValueOnce(false)
            const result = await loginService(
                {
                    username: 'kevin',
                    password:
                        failure === 'incorrect password'
                            ? 'wrong-password'
                            : validPassword,
                    twoFactorCode:
                        failure === 'missing TOTP' ? undefined : '123456',
                    trustThisDevice: true,
                },
                recoveryAttemptFixture(),
            )
            expect(result).toMatchObject({ success: false, code })
            expect(mockedClaimRecoveryAttempt).not.toHaveBeenCalled()
            expect(
                mockedCreateAuthenticatedSessionForUser,
            ).not.toHaveBeenCalled()
        },
    )

    it('waits for complete TOTP verification before claiming the exact recovery attempt', async function () {
        const { user, factor } = installVerifiedFactor()
        const attempt = recoveryAttemptFixture()
        let finishTotp: ((verified: boolean) => void) | undefined
        mockedConsumeTotpCode.mockImplementationOnce(function () {
            return new Promise<boolean>(function (resolve) {
                finishTotp = resolve
            })
        })
        const pending = loginService(
            {
                username: user.username,
                password: validPassword,
                twoFactorCode: '123456',
                trustThisDevice: true,
            },
            attempt,
        )
        await waitForAssertion(() => expect(finishTotp).toBeDefined())
        expect(mockedClaimRecoveryAttempt).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
        finishTotp?.(true)
        expect(await pending).toMatchObject({ success: true })
        expect(mockedConsumeTotpCode).toHaveBeenCalledWith(factor, '123456')
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledTimes(1)
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledWith(attempt, user)
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledWith({
            user,
            proof: {
                kind: 'password',
                trustThisDevice: true,
                factorId: 'factor-1',
            },
            auditAction: 'auth.login',
            auditMessage: 'Benutzer kevin hat sich angemeldet.',
        })
    })

    it('waits for an accepted recovery claim before issuing the session or trusted device', async function () {
        const { user } = installVerifiedFactor()
        const attempt = recoveryAttemptFixture()
        let finishClaim: ((accepted: boolean) => void) | undefined
        mockedClaimRecoveryAttempt.mockImplementationOnce(function () {
            return new Promise<boolean>(function (resolve) {
                finishClaim = resolve
            })
        })
        const pending = loginService(
            {
                username: user.username,
                password: validPassword,
                twoFactorCode: '123456',
                trustThisDevice: true,
            },
            attempt,
        )
        await waitForAssertion(() => expect(finishClaim).toBeDefined())
        expect(mockedConsumeTotpCode).toHaveBeenCalledTimes(1)
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledWith(attempt, user)
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
        finishClaim?.(true)
        expect(await pending).toMatchObject({ success: true })
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledTimes(1)
    })

    it('rejects a denied recovery claim after valid password and MFA without issuing credentials', async function () {
        const { user } = installVerifiedFactor()
        const attempt = recoveryAttemptFixture()
        mockedClaimRecoveryAttempt.mockResolvedValueOnce(false)
        expect(
            await loginService(
                {
                    username: user.username,
                    password: validPassword,
                    twoFactorCode: '123456',
                    trustThisDevice: true,
                },
                attempt,
            ),
        ).toEqual({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        expect(mockedConsumeTotpCode).toHaveBeenCalledTimes(1)
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledWith(attempt, user)
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('fails closed when the asynchronous recovery claim throws after MFA verification', async function () {
        installVerifiedFactor()
        mockedClaimRecoveryAttempt.mockRejectedValueOnce(
            new Error('Synthetic recovery claim failure'),
        )
        expect(
            await loginService(
                {
                    username: 'kevin',
                    password: validPassword,
                    twoFactorCode: '123456',
                    trustThisDevice: true,
                },
                recoveryAttemptFixture(),
            ),
        ).toMatchObject({ success: false, code: 'INTERNAL_ERROR' })
        expect(mockedConsumeTotpCode).toHaveBeenCalledTimes(1)
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledTimes(1)
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('does not claim recovery when persisting the verified TOTP fails', async function () {
        installVerifiedFactor()
        mockedConsumeTotpCode.mockRejectedValueOnce(
            new Error('Synthetic TOTP persistence failure'),
        )
        expect(
            await loginService(
                {
                    username: 'kevin',
                    password: validPassword,
                    twoFactorCode: '123456',
                    trustThisDevice: true,
                },
                recoveryAttemptFixture(),
            ),
        ).toMatchObject({ success: false, code: 'INTERNAL_ERROR' })
        expect(mockedClaimRecoveryAttempt).not.toHaveBeenCalled()
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })

    it('still claims recovery for a password-only account before finalization', async function () {
        const user = { ...createTwoFactorUser(), isTwoFactorEnabled: false }
        dbMock.state.selectResults = [[user], []]
        const attempt = recoveryAttemptFixture()
        expect(
            await loginService(
                {
                    username: user.username,
                    password: validPassword,
                    trustThisDevice: true,
                },
                attempt,
            ),
        ).toMatchObject({ success: true })
        expect(mockedConsumeTotpCode).not.toHaveBeenCalled()
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledWith(attempt, user)
        expect(mockedCreateAuthenticatedSessionForUser).toHaveBeenCalledWith({
            user,
            proof: { kind: 'password', trustThisDevice: false, factorId: null },
            auditAction: 'auth.login',
            auditMessage: 'Benutzer kevin hat sich angemeldet.',
        })
    })
    it('does not let a trusted device bypass a denied recovery claim', async function () {
        const { user } = installVerifiedFactor()
        const attempt = recoveryAttemptFixture()
        mockedHasTrustedDevice.mockResolvedValueOnce(true)
        mockedClaimRecoveryAttempt.mockResolvedValueOnce(false)
        expect(
            await loginService(
                {
                    username: user.username,
                    password: validPassword,
                    trustThisDevice: true,
                },
                attempt,
            ),
        ).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' })
        expect(mockedConsumeTotpCode).not.toHaveBeenCalled()
        expect(mockedClaimRecoveryAttempt).toHaveBeenCalledWith(attempt, user)
        expect(mockedCreateAuthenticatedSessionForUser).not.toHaveBeenCalled()
    })
})
