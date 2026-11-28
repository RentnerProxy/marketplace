import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { loginService } from '@/server/Auth/Login/login.service.ts'
import { notifyExistingUserAboutFailedLogin } from '@/server/Auth/Login/failedLoginAlert.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import {
    reserveLoginAttemptService,
    finishLoginAttemptService,
    recordFailedLogin,
} from '@/server/RateLimit/login-attempt.service.ts'
import type {
    LoginAttempt,
    ReserveLoginAttemptResult,
    FinishLoginAttemptResult,
} from '@/server/RateLimit/Types/login-attempt.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'
import { reserveLoginRecoveryAttemptService } from '@/server/Auth/Login/recovery.service.ts'
import type { LoginRecoveryAttempt } from '@/server/Auth/Types/login-recovery.types.ts'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const normalAttempt: LoginAttempt = {
    generation: Buffer.alloc(32, 7).toString('base64url'),
    attemptId: Buffer.alloc(32, 8).toString('base64url'),
    expiresAtMs: 1_800_000_030_000,
}

const enumerationMocks = (function () {
    const guards: Array<{ wait: ReturnType<typeof vi.fn> }> = []
    const create = vi.fn(function () {
        const guard = {
            wait: vi.fn(async function () {}),
        }
        guards.push(guard)
        return guard
    })

    return { create, guards }
})()

const rateLimitMocks = (function () {
    class MockRateLimitError extends Error {
        readonly retryAfterSeconds: number

        constructor(retryAfterSeconds: number) {
            super(`Retry after ${retryAfterSeconds}`)
            this.retryAfterSeconds = retryAfterSeconds
        }
    }

    return {
        reserveLoginAttemptService: vi.fn(
            async function (): Promise<ReserveLoginAttemptResult> {
                return { allowed: true, attempt: normalAttempt }
            },
        ),
        finishLoginAttemptService: vi.fn(
            async function (): Promise<FinishLoginAttemptResult> {
                return {
                    applied: true,
                    lockDurationSeconds: 0,
                    lockCreated: false,
                }
            },
        ),
        enforceRateLimit: vi.fn(async function () {}),
        recordFailedLogin: vi.fn(async function () {
            return { lockDurationSeconds: 0, lockCreated: false }
        }),
        RateLimitError: MockRateLimitError,
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

vi.mock('@/server/Auth/Login/recovery.service.ts', function () {
    return {
        reserveLoginRecoveryAttemptService: vi.fn(
            async function (): Promise<LoginRecoveryAttempt | null> {
                return null
            },
        ),
    }
})

vi.mock('@/server/Auth/Login/login.service.ts', function () {
    return { loginService: vi.fn() }
})

vi.mock('@/server/Auth/Login/failedLoginAlert.service.ts', function () {
    return {
        notifyExistingUserAboutFailedLogin: vi.fn(async function () {}),
    }
})

vi.mock('@/server/RateLimit/rateLimit.service.ts', function () {
    return {
        enforceRateLimit: rateLimitMocks.enforceRateLimit,
        RateLimitError: rateLimitMocks.RateLimitError,
    }
})

vi.mock('@/server/RateLimit/login-attempt.service.ts', function () {
    return {
        reserveLoginAttemptService: rateLimitMocks.reserveLoginAttemptService,
        finishLoginAttemptService: rateLimitMocks.finishLoginAttemptService,
        recordFailedLogin: rateLimitMocks.recordFailedLogin,
    }
})

vi.mock('@/server/Auth/Passkey/login.service.ts', function () {
    return {
        beginPasskeyLoginService: vi.fn(),
        finishPasskeyLoginService: vi.fn(),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

vi.mock('@/server/Auth/enumerationProtection.service.ts', function () {
    return { createEnumerationProtection: enumerationMocks.create }
})

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>
const { loginHandler, beginPasskeyLoginHandler, finishPasskeyLoginHandler } =
    await import('@/features/Auth/Login/middleware.ts')

const mockedLoginService = loginService as Mock<typeof loginService>
const mockedReserveRecovery = reserveLoginRecoveryAttemptService as Mock<
    typeof reserveLoginRecoveryAttemptService
>
const mockedNotifyFailedLogin = notifyExistingUserAboutFailedLogin as Mock<
    typeof notifyExistingUserAboutFailedLogin
>
const mockedEnforceRateLimit = enforceRateLimit as Mock<typeof enforceRateLimit>
const mockedReserveLoginAttempt = reserveLoginAttemptService as Mock<
    typeof reserveLoginAttemptService
>
const mockedRecordFailedLogin = recordFailedLogin as Mock<
    typeof recordFailedLogin
>
const mockedFinishLoginAttempt = finishLoginAttemptService as Mock<
    typeof finishLoginAttemptService
>
const mockedLogError = logError as Mock<typeof logError>
const mockedCreateEnumerationProtection = createEnumerationProtection as Mock<
    typeof createEnumerationProtection
>

const loginData = {
    username: 'kevin',
    password: 'wrong',
}

describe('Login-Lockout-Handler', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        enumerationMocks.guards.length = 0
        mockedReserveRecovery.mockReset()
        mockedReserveRecovery.mockResolvedValue(null)
        mockedReserveLoginAttempt.mockReset()
        mockedReserveLoginAttempt.mockResolvedValue({
            allowed: true,
            attempt: normalAttempt,
        })
        mockedFinishLoginAttempt.mockReset()
        mockedFinishLoginAttempt.mockResolvedValue({
            applied: true,
            lockDurationSeconds: 0,
            lockCreated: false,
        })
        mockedRecordFailedLogin.mockResolvedValue({
            lockDurationSeconds: 0,
            lockCreated: false,
        })
    })

    it('prüft das IP-Spray-Limit vor Account und Passwort', async function () {
        mockedEnforceRateLimit.mockRejectedValueOnce(new Error('IP gesperrt'))

        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'IP gesperrt',
        )
        expect(mockedReserveLoginAttempt).not.toHaveBeenCalled()
        expect(mockedReserveRecovery).not.toHaveBeenCalled()
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedCreateEnumerationProtection).toHaveBeenNthCalledWith(
            1,
            750,
        )
        expect(mockedCreateEnumerationProtection).toHaveBeenNthCalledWith(
            2,
            2_000,
        )
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
        expect(enumerationMocks.guards[1]?.wait).not.toHaveBeenCalled()
    })

    it('zählt ungültige Zugangsdaten anhand des stabilen Codes', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'beliebiger übersetzter Text',
        })

        const result = await loginHandler({ data: loginData })

        expect(result.success).toBe(false)
        expect(mockedFinishLoginAttempt).toHaveBeenCalledWith(
            'kevin',
            normalAttempt,
            'failure',
        )
        expect(mockedNotifyFailedLogin).not.toHaveBeenCalled()
    })

    it('plant beim neuen Lock genau eine Sicherheitswarnung ein', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        mockedFinishLoginAttempt.mockResolvedValueOnce({
            applied: true,
            lockDurationSeconds: 30,
            lockCreated: true,
        })

        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 30',
        )
        expect(mockedNotifyFailedLogin).toHaveBeenCalledTimes(1)
        expect(mockedNotifyFailedLogin).toHaveBeenCalledWith('kevin')
        expect(enumerationMocks.guards[0]?.wait).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[1]?.wait).toHaveBeenCalledTimes(1)
    })

    it('versendet bei einem bereits parallel gesetzten Lock keine zweite Mail', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        mockedFinishLoginAttempt.mockResolvedValueOnce({
            applied: false,
            lockDurationSeconds: 29,
            lockCreated: false,
        })

        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 29',
        )
        expect(mockedNotifyFailedLogin).not.toHaveBeenCalled()
    })

    it('zählt die Aufforderung zum 2FA-Code nicht als Fehlversuch', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'TWO_FACTOR_REQUIRED',
            requiresTwoFactor: true,
            error: 'Bitte gib deinen 2FA-Code ein.',
        })

        const result = await loginHandler({ data: loginData })

        expect(result).toMatchObject({
            success: false,
            code: 'TWO_FACTOR_REQUIRED',
        })
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('setzt den Account-Zähler nur nach vollständigem Login zurück', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: true,
            redirectTo: '/user/catalog',
            user: {
                id: 'user-1',
                username: 'kevin',
                email: 'kevin@example.test',
                isActive: true,
                permissions: [],
            },
        })

        await loginHandler({ data: loginData })

        expect(mockedFinishLoginAttempt).toHaveBeenCalledWith(
            'kevin',
            normalAttempt,
            'success',
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('liefert einen erfolgreichen Login trotz Valkey-Abschlussfehler aus', async function () {
        const successfulLogin = {
            success: true as const,
            redirectTo: '/user/catalog',
            user: {
                id: 'user-1',
                username: 'kevin',
                email: 'kevin@example.test',
                isActive: true,
                permissions: [],
            },
        }
        const valkeyError = new Error('Valkey nicht erreichbar')
        mockedLoginService.mockResolvedValueOnce(successfulLogin)
        mockedFinishLoginAttempt.mockRejectedValueOnce(valkeyError)

        const result = await loginHandler({ data: loginData })

        expect(result).toEqual(successfulLogin)
        expect(mockedLogError).toHaveBeenCalledWith(
            'auth.login.attempt_completion_failed',
            valkeyError,
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })
    it('keeps an anonymous account lock effective when no recovery grant was reserved', async function () {
        mockedReserveLoginAttempt.mockResolvedValueOnce({
            allowed: false,
            reason: 'locked',
            retryAfterSeconds: 900,
            lockCreated: false,
        })
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 900',
        )
        expect(mockedReserveRecovery).toHaveBeenCalledWith(loginData.username)
        expect(mockedReserveLoginAttempt).toHaveBeenCalledWith(
            loginData.username,
        )
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
    })

    it('allows the reserved recovery attempt through a relocked account without clearing its attacker state', async function () {
        const attempt: LoginRecoveryAttempt = {
            grantTokenHash: 'a'.repeat(64),
            attemptId: Buffer.alloc(32, 1).toString('base64url'),
        }
        const success = {
            success: true as const,
            redirectTo: '/user/catalog',
            user: {
                id: 'user-1',
                username: 'kevin',
                email: 'kevin@example.test',
                isActive: true,
                permissions: [],
            },
        }
        mockedReserveRecovery.mockResolvedValueOnce(attempt)
        mockedReserveLoginAttempt.mockRejectedValueOnce(
            new rateLimitMocks.RateLimitError(900),
        )
        mockedLoginService.mockResolvedValueOnce(success)

        expect(await loginHandler({ data: loginData })).toEqual(success)
        expect(mockedEnforceRateLimit).toHaveBeenCalledWith({
            scope: 'login-ip',
            limit: 50,
            windowMs: 15 * 60_000,
        })
        expect(mockedReserveLoginAttempt).not.toHaveBeenCalled()
        expect(mockedLoginService).toHaveBeenCalledWith(loginData, attempt)
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
    })

    it('keeps the two-factor prompt neutral while retaining the reserved recovery context', async function () {
        const attempt: LoginRecoveryAttempt = {
            grantTokenHash: 'b'.repeat(64),
            attemptId: Buffer.alloc(32, 2).toString('base64url'),
        }
        mockedReserveRecovery.mockResolvedValueOnce(attempt)
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'TWO_FACTOR_REQUIRED',
            requiresTwoFactor: true,
            error: 'Bitte gib deinen 2FA-Code ein.',
        })
        expect(await loginHandler({ data: loginData })).toMatchObject({
            success: false,
            requiresTwoFactor: true,
        })
        expect(mockedLoginService).toHaveBeenCalledWith(loginData, attempt)
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
    })

    it('still records invalid recovery credentials against the existing account state', async function () {
        mockedReserveRecovery.mockResolvedValueOnce({
            grantTokenHash: 'c'.repeat(64),
            attemptId: Buffer.alloc(32, 3).toString('base64url'),
        })
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        mockedRecordFailedLogin.mockResolvedValueOnce({
            lockDurationSeconds: 900,
            lockCreated: false,
        })
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 900',
        )
        expect(mockedRecordFailedLogin).toHaveBeenCalledWith(loginData.username)
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(mockedNotifyFailedLogin).not.toHaveBeenCalled()
    })

    it('does not authenticate or fall back when recovery reservation fails', async function () {
        mockedReserveRecovery.mockRejectedValueOnce(
            new Error('synthetic recovery storage failure'),
        )
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'synthetic recovery storage failure',
        )
        expect(mockedReserveLoginAttempt).not.toHaveBeenCalled()
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
    })

    it('waits for an atomic recovery reservation before selecting a login path', async function () {
        let finishReservation:
            ((attempt: LoginRecoveryAttempt | null) => void) | undefined
        mockedReserveRecovery.mockReturnValueOnce(
            new Promise<LoginRecoveryAttempt | null>((resolve) => {
                finishReservation = resolve
            }),
        )
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        const pending = loginHandler({ data: loginData })
        await waitForAssertion(() =>
            expect(mockedReserveRecovery).toHaveBeenCalledTimes(1),
        )
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedReserveLoginAttempt).not.toHaveBeenCalled()
        finishReservation?.(null)
        expect(await pending).toMatchObject({ success: false })
        expect(mockedReserveLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedLoginService).toHaveBeenCalledWith(loginData, undefined)
    })

    it('rejects a full reservation budget without starting authentication', async function () {
        mockedReserveLoginAttempt.mockResolvedValueOnce({
            allowed: false,
            reason: 'busy',
            retryAfterSeconds: 12,
            lockCreated: false,
        })
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 12',
        )
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(mockedNotifyFailedLogin).not.toHaveBeenCalled()
    })

    it('does not authenticate when normal admission storage fails', async function () {
        mockedReserveLoginAttempt.mockRejectedValueOnce(
            new Error('synthetic admission unavailable'),
        )
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'synthetic admission unavailable',
        )
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
    })

    it('waits for a confirmed normal reservation before checking credentials', async function () {
        let releaseAdmission:
            ((result: ReserveLoginAttemptResult) => void) | undefined
        mockedReserveLoginAttempt.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseAdmission = resolve
            }),
        )
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Invalid',
        })
        const pending = loginHandler({ data: loginData })
        await waitForAssertion(() =>
            expect(mockedReserveLoginAttempt).toHaveBeenCalledTimes(1),
        )
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        releaseAdmission?.({ allowed: true, attempt: normalAttempt })
        await pending
        expect(mockedLoginService).toHaveBeenCalledTimes(1)
        expect(mockedFinishLoginAttempt).toHaveBeenCalledWith(
            'kevin',
            normalAttempt,
            'failure',
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('releases a reservation exactly once after an unexpected authentication exception', async function () {
        mockedLoginService.mockRejectedValueOnce(
            new Error('synthetic authentication failure'),
        )
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'synthetic authentication failure',
        )
        expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedFinishLoginAttempt).toHaveBeenCalledWith(
            'kevin',
            normalAttempt,
            'neutral',
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[0]?.wait).toHaveBeenCalledTimes(1)
    })

    it('waits for completion before returning a failed credential response', async function () {
        let releaseCompletion:
            ((result: FinishLoginAttemptResult) => void) | undefined
        let returned = false
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_TWO_FACTOR',
            requiresTwoFactor: true,
            error: 'Invalid code',
        })
        mockedFinishLoginAttempt.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseCompletion = resolve
            }),
        )
        const pending = loginHandler({ data: loginData }).then((result) => {
            returned = true
            return result
        })
        await waitForAssertion(() =>
            expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1),
        )
        expect(returned).toBe(false)
        expect(mockedFinishLoginAttempt).toHaveBeenCalledWith(
            'kevin',
            normalAttempt,
            'failure',
        )
        releaseCompletion?.({
            applied: true,
            lockCreated: false,
            lockDurationSeconds: 0,
        })
        expect(await pending).toMatchObject({ code: 'INVALID_TWO_FACTOR' })
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('finishes MFA prompts and internal error results neutrally', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'TWO_FACTOR_REQUIRED',
            requiresTwoFactor: true,
            error: 'Enter code',
        })
        await loginHandler({ data: loginData })
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INTERNAL_ERROR',
            error: 'Unavailable',
        })
        await loginHandler({ data: loginData })
        expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(2)
        expect(mockedFinishLoginAttempt).toHaveBeenNthCalledWith(
            1,
            'kevin',
            normalAttempt,
            'neutral',
        )
        expect(mockedFinishLoginAttempt).toHaveBeenNthCalledWith(
            2,
            'kevin',
            normalAttempt,
            'neutral',
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('completes before notification failure and never consumes the reservation twice', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Invalid',
        })
        mockedFinishLoginAttempt.mockResolvedValueOnce({
            applied: true,
            lockCreated: true,
            lockDurationSeconds: 30,
        })
        mockedNotifyFailedLogin.mockImplementationOnce(async function () {
            expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1)
            throw new Error('synthetic notification failure')
        })
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'synthetic notification failure',
        )
        expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[1]?.wait).toHaveBeenCalledTimes(1)
    })

    it('does not hide uncertain completion of a failed login or retry admission', async function () {
        const error = new Error('synthetic completion unavailable')
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Invalid',
        })
        mockedFinishLoginAttempt.mockRejectedValueOnce(error)
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'synthetic completion unavailable',
        )
        expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedReserveLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedLogError).toHaveBeenCalledWith(
            'auth.login.attempt_completion_failed',
            error,
        )
        expect(mockedRecordFailedLogin).not.toHaveBeenCalled()
    })

    it('preserves the original authentication exception if cleanup also fails', async function () {
        mockedLoginService.mockRejectedValueOnce(
            new Error('original authentication failure'),
        )
        mockedFinishLoginAttempt.mockRejectedValueOnce(
            new Error('secondary completion failure'),
        )
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'original authentication failure',
        )
        expect(mockedFinishLoginAttempt).toHaveBeenCalledTimes(1)
        expect(mockedLogError).toHaveBeenCalledTimes(1)
    })

    it('notifies once when admission charges abandoned attempts and creates a new lock', async function () {
        mockedReserveLoginAttempt.mockResolvedValueOnce({
            allowed: false,
            reason: 'locked',
            retryAfterSeconds: 30,
            lockCreated: true,
        })
        await expect(loginHandler({ data: loginData })).rejects.toThrow(
            'Retry after 30',
        )
        expect(mockedNotifyFailedLogin).toHaveBeenCalledTimes(1)
        expect(mockedLoginService).not.toHaveBeenCalled()
        expect(mockedFinishLoginAttempt).not.toHaveBeenCalled()
        expect(enumerationMocks.guards[1]?.wait).toHaveBeenCalledTimes(1)
    })
    it.each([
        ['INVALID_CREDENTIALS', 'invalid_credentials'],
        ['INVALID_TWO_FACTOR', 'invalid_two_factor'],
        ['USER_INACTIVE', 'inactive_account'],
    ] as const)(
        'records %s once after account bookkeeping',
        async function (code, reason) {
            if (code === 'INVALID_TWO_FACTOR') {
                mockedLoginService.mockResolvedValueOnce({
                    success: false,
                    code,
                    requiresTwoFactor: true,
                    error: 'synthetic private input',
                })
            } else {
                mockedLoginService.mockResolvedValueOnce({
                    success: false,
                    code,
                    error: 'synthetic private input',
                })
            }
            mockedFinishLoginAttempt.mockImplementationOnce(async function () {
                expect(mockedRejection).not.toHaveBeenCalled()
                return {
                    applied: true,
                    lockDurationSeconds: 0,
                    lockCreated: false,
                }
            })
            expect((await loginHandler({ data: loginData })).success).toBe(
                false,
            )
            expect(mockedRejection.mock.calls).toEqual([
                ['password_login', reason],
            ])
        },
    )

    it.each([
        'TWO_FACTOR_REQUIRED',
        'TWO_FACTOR_CONFIGURATION_INVALID',
        'INTERNAL_ERROR',
    ] as const)(
        'does not count %s as a rejected authentication',
        async function (code) {
            if (code === 'TWO_FACTOR_REQUIRED') {
                mockedLoginService.mockResolvedValueOnce({
                    success: false,
                    code,
                    requiresTwoFactor: true,
                    error: 'synthetic',
                })
            } else {
                mockedLoginService.mockResolvedValueOnce({
                    success: false,
                    code,
                    error: 'synthetic',
                })
            }
            await loginHandler({ data: loginData })
            expect(mockedRejection).not.toHaveBeenCalled()
        },
    )

    it.each([
        { reason: 'locked', lockCreated: false, expected: 'account_locked' },
        { reason: 'busy', lockCreated: false, expected: 'attempts_busy' },
        {
            reason: 'locked',
            lockCreated: true,
            expected: 'account_lock_created',
        },
    ] as const)(
        'records admission $expected once without credential validation',
        async function (entry) {
            mockedReserveLoginAttempt.mockResolvedValueOnce({
                allowed: false,
                reason: entry.reason,
                lockCreated: entry.lockCreated,
                retryAfterSeconds: 30,
            })
            await expect(loginHandler({ data: loginData })).rejects.toThrow()
            expect(mockedRejection.mock.calls).toEqual([
                ['password_login', entry.expected],
            ])
            expect(mockedLoginService).not.toHaveBeenCalled()
        },
    )

    it.each([true, false])(
        'records final lock state rather than duplicating a credential rejection (%s)',
        async function (created) {
            mockedLoginService.mockResolvedValueOnce({
                success: false,
                code: 'INVALID_TWO_FACTOR',
                error: 'synthetic',
                requiresTwoFactor: true,
            })
            mockedFinishLoginAttempt.mockResolvedValueOnce({
                applied: true,
                lockCreated: created,
                lockDurationSeconds: 30,
            })
            await expect(loginHandler({ data: loginData })).rejects.toThrow()
            expect(mockedRejection.mock.calls).toEqual([
                [
                    'password_login',
                    created ? 'account_lock_created' : 'account_locked',
                ],
            ])
        },
    )

    it('counts confirmed IP quotas but preserves infrastructure errors without a denial event', async function () {
        const quota = new rateLimitMocks.RateLimitError(20)
        mockedEnforceRateLimit.mockRejectedValueOnce(quota)
        await expect(loginHandler({ data: loginData })).rejects.toBe(quota)
        expect(mockedRejection.mock.calls).toEqual([
            ['password_login', 'rate_limited'],
        ])
        mockedRejection.mockClear()
        const infrastructure = new Error('synthetic Valkey failure')
        mockedEnforceRateLimit.mockRejectedValueOnce(infrastructure)
        await expect(loginHandler({ data: loginData })).rejects.toBe(
            infrastructure,
        )
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('does not misclassify failed completion storage as a credential denial', async function () {
        mockedLoginService.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'synthetic',
        })
        const storage = new Error('synthetic accounting failure')
        mockedFinishLoginAttempt.mockRejectedValueOnce(storage)
        await expect(loginHandler({ data: loginData })).rejects.toBe(storage)
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it.each([
        { stage: 'begin', blockedCall: 1 },
        { stage: 'begin', blockedCall: 2 },
        { stage: 'finish', blockedCall: 1 },
        { stage: 'finish', blockedCall: 2 },
    ])(
        'records passkey $stage quota $blockedCall exactly once',
        async function ({ stage, blockedCall }) {
            const quota = new rateLimitMocks.RateLimitError(20)
            if (blockedCall === 2)
                mockedEnforceRateLimit.mockResolvedValueOnce(undefined)
            mockedEnforceRateLimit.mockRejectedValueOnce(quota)
            const operation =
                stage === 'begin'
                    ? beginPasskeyLoginHandler({
                          data: { username: 'synthetic-user' },
                      })
                    : finishPasskeyLoginHandler({
                          data: {
                              challengeId:
                                  '0197f495-622c-70ad-9fd4-11edce58c001',
                              response: {
                                  id: 'synthetic',
                                  rawId: 'synthetic',
                                  type: 'public-key',
                                  response: {},
                                  clientExtensionResults: {},
                              },
                          },
                      })
            await expect(operation).rejects.toBe(quota)
            expect(mockedRejection.mock.calls).toEqual([
                ['passkey_login', 'rate_limited'],
            ])
        },
    )
})
