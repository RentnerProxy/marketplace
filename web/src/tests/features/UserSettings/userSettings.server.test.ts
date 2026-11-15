import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'
import type { Mock } from 'bun:test'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { RateLimitError } from '@/server/RateLimit/rateLimit.service.ts'
import { createAccountRateLimitTestHarness } from './account-rate-limit.test.helpers.ts'

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

const events: Array<string> = []
const rateLimits = createAccountRateLimitTestHarness(() =>
    events.push('rate-limit'),
)
const userId = '00000000-0000-4000-8000-000000000001'
const access = {
    sessionUser: { id: userId, sessionHash: 'first-synthetic-session' },
    permissionKeys: [],
}
const accessMocks = {
    requireAccess: vi.fn(async function () {
        return access
    }),
    getCurrentUserId: vi.fn(async function () {
        events.push('session-id')
        return userId
    }),
    enforceRateLimit: rateLimits.enforce,
}

const successResult = { success: true as const }
const twoFactorStatusResult = { isEnabled: false, isSetupPending: false }
const passkeysResult = { passkeys: [] }

function mockOperation<T>(name: string, result: T) {
    return vi.fn(async function (..._args: Array<unknown>) {
        events.push(name)
        return result
    })
}

const services = {
    personalInfo: mockOperation('personal-info', successResult),
    passwordReset: mockOperation('password-reset', successResult),
    profileImage: mockOperation('profile-image', successResult),
    primaryColor: mockOperation('primary-color', successResult),
    resetPrimaryColor: mockOperation('reset-primary-color', successResult),
    themeMode: mockOperation('theme-mode', successResult),
    fontFamily: mockOperation('font-family', successResult),
    fontSize: mockOperation('font-size', successResult),
    background: mockOperation('background', successResult),
    backgroundAppearance: mockOperation('background-appearance', successResult),
    deleteBackground: mockOperation('delete-background', successResult),
    twoFactorStatus: mockOperation('two-factor-status', twoFactorStatusResult),
    twoFactorBegin: mockOperation('two-factor-begin', successResult),
    twoFactorConfirm: mockOperation('two-factor-confirm', successResult),
    twoFactorDisable: mockOperation('two-factor-disable', successResult),
    passkeys: mockOperation('passkeys', passkeysResult),
    passkeyBegin: mockOperation('passkey-begin', successResult),
    passkeyFinish: mockOperation('passkey-finish', successResult),
    passkeyDelete: mockOperation('passkey-delete', successResult),
}

vi.mock('@tanstack/react-start', function () {
    return {
        createServerFn: function () {
            return {
                handler: function (operation: () => Promise<unknown>) {
                    return operation
                },
                validator: function (validate: (input: unknown) => unknown) {
                    return {
                        handler: function (
                            operation: (context: {
                                data: unknown
                            }) => Promise<unknown>,
                        ) {
                            return async function (input: { data: unknown }) {
                                return operation({ data: validate(input.data) })
                            }
                        },
                    }
                },
            }
        },
    }
})
vi.mock('@/server/Auth/authorization.service.ts', function () {
    return {
        requireAuthenticatedFeatureAccessService: accessMocks.requireAccess,
    }
})
vi.mock('@/server/Auth/currentSession.ts', function () {
    return { getCurrentSessionUserId: accessMocks.getCurrentUserId }
})
rateLimits.install()
vi.mock('@/server/UserSettings/profile.service.ts', function () {
    return {
        updateCurrentUserPersonalInfoService: services.personalInfo,
        updateCurrentUserProfileImageService: services.profileImage,
    }
})
vi.mock(
    '@/server/UserSettings/Security/password-reset.service.ts',
    function () {
        return {
            requestCurrentUserPasswordResetService: services.passwordReset,
        }
    },
)
vi.mock('@/server/UserSettings/theme.service.ts', function () {
    return {
        updateCurrentUserPrimaryColorService: services.primaryColor,
        resetCurrentUserPrimaryColorService: services.resetPrimaryColor,
        updateCurrentUserThemeModeService: services.themeMode,
        updateCurrentUserFontFamilyService: services.fontFamily,
        updateCurrentUserFontSizeService: services.fontSize,
    }
})
vi.mock('@/server/UserSettings/background.service.ts', function () {
    return {
        updateCurrentUserBackgroundService: services.background,
        updateCurrentUserBackgroundAppearanceService:
            services.backgroundAppearance,
        deleteCurrentUserBackgroundService: services.deleteBackground,
    }
})
vi.mock('@/server/UserSettings/Security/two-factor.service.ts', function () {
    return {
        getCurrentTwoFactorStatusService: services.twoFactorStatus,
        beginCurrentUserTwoFactorSetupService: services.twoFactorBegin,
        confirmCurrentUserTwoFactorSetupService: services.twoFactorConfirm,
        disableCurrentUserTwoFactorService: services.twoFactorDisable,
    }
})
vi.mock('@/server/Auth/Passkey/management.service.ts', function () {
    return {
        getCurrentUserPasskeysService: services.passkeys,
        deleteCurrentUserPasskeyService: services.passkeyDelete,
    }
})
vi.mock('@/server/Auth/Passkey/registration.service.ts', function () {
    return {
        beginCurrentUserPasskeyRegistrationService: services.passkeyBegin,
        finishCurrentUserPasskeyRegistrationService: services.passkeyFinish,
    }
})

const handlers = await import('@/features/UserSettings/middleware.ts')
const personalInfo = {
    firstName: 'Test',
    lastName: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
}
const imageInput = {
    imageDataUrl: 'data:image/webp;base64,dGVzdA==',
    crop: { x: 0, y: 0, width: 8, height: 8 },
}
const reauthentication = {
    reauthentication: {
        method: 'password' as const,
        credential: 'synthetic-password',
    },
}
const confirmation = { setupToken: userId, token: '123456' }
const registration = {
    challengeId: '0197f495-622c-70ad-9fd4-11edce58c001',
    registrationToken: userId,
    response: {
        id: 'synthetic-id',
        rawId: 'synthetic-id',
        type: 'public-key' as const,
        response: {},
        clientExtensionResults: {},
    },
}
const passkeyDeletion = {
    passkeyId: registration.challengeId,
    ...reauthentication,
}

const operations = [
    {
        name: 'updateCurrentUserPersonalInfoHandler',
        invoke: () =>
            handlers.updateCurrentUserPersonalInfoHandler({
                data: personalInfo,
            }),
        service: services.personalInfo,
        expected: successResult,
        args: [personalInfo],
    },
    {
        name: 'requestCurrentUserPasswordResetHandler',
        invoke: () => handlers.requestCurrentUserPasswordResetHandler(),
        service: services.passwordReset,
        expected: successResult,
        args: [],
    },
    {
        name: 'updateCurrentUserProfileImageHandler',
        invoke: () =>
            handlers.updateCurrentUserProfileImageHandler({ data: imageInput }),
        service: services.profileImage,
        expected: successResult,
        args: [imageInput],
    },
    {
        name: 'updateCurrentUserPrimaryColorHandler',
        invoke: () =>
            handlers.updateCurrentUserPrimaryColorHandler({
                data: { primaryColor: '#123456' },
            }),
        service: services.primaryColor,
        expected: successResult,
        args: [{ primaryColor: '#123456' }],
    },
    {
        name: 'resetCurrentUserPrimaryColorHandler',
        invoke: () => handlers.resetCurrentUserPrimaryColorHandler(),
        service: services.resetPrimaryColor,
        expected: successResult,
        args: [],
    },
    {
        name: 'updateCurrentUserThemeModeHandler',
        invoke: () =>
            handlers.updateCurrentUserThemeModeHandler({
                data: { themeMode: 'light' },
            }),
        service: services.themeMode,
        expected: successResult,
        args: [{ themeMode: 'light' }],
    },
    {
        name: 'updateCurrentUserFontFamilyHandler',
        invoke: () =>
            handlers.updateCurrentUserFontFamilyHandler({
                data: { fontFamily: 'serif' },
            }),
        service: services.fontFamily,
        expected: successResult,
        args: [{ fontFamily: 'serif' }],
    },
    {
        name: 'updateCurrentUserFontSizeHandler',
        invoke: () =>
            handlers.updateCurrentUserFontSizeHandler({
                data: { fontSize: 18 },
            }),
        service: services.fontSize,
        expected: successResult,
        args: [{ fontSize: 18 }],
    },
    {
        name: 'updateCurrentUserBackgroundHandler',
        invoke: () =>
            handlers.updateCurrentUserBackgroundHandler({ data: imageInput }),
        service: services.background,
        expected: successResult,
        args: [imageInput],
    },
    {
        name: 'updateCurrentUserBackgroundAppearanceHandler',
        invoke: () =>
            handlers.updateCurrentUserBackgroundAppearanceHandler({
                data: { customBackgroundDarkness: 75 },
            }),
        service: services.backgroundAppearance,
        expected: successResult,
        args: [{ customBackgroundDarkness: 75 }],
    },
    {
        name: 'deleteCurrentUserBackgroundHandler',
        invoke: () => handlers.deleteCurrentUserBackgroundHandler(),
        service: services.deleteBackground,
        expected: successResult,
        args: [],
    },
    {
        name: 'getCurrentTwoFactorStatusHandler',
        invoke: () => handlers.getCurrentTwoFactorStatusHandler(),
        service: services.twoFactorStatus,
        expected: twoFactorStatusResult,
        args: [],
    },
    {
        name: 'beginCurrentUserTwoFactorSetupHandler',
        invoke: () =>
            handlers.beginCurrentUserTwoFactorSetupHandler({
                data: reauthentication,
            }),
        service: services.twoFactorBegin,
        expected: successResult,
        args: [reauthentication],
    },
    {
        name: 'confirmCurrentUserTwoFactorSetupHandler',
        invoke: () =>
            handlers.confirmCurrentUserTwoFactorSetupHandler({
                data: confirmation,
            }),
        service: services.twoFactorConfirm,
        expected: successResult,
        args: [confirmation],
    },
    {
        name: 'disableCurrentUserTwoFactorHandler',
        invoke: () =>
            handlers.disableCurrentUserTwoFactorHandler({
                data: reauthentication,
            }),
        service: services.twoFactorDisable,
        expected: successResult,
        args: [reauthentication],
    },
    {
        name: 'getCurrentUserPasskeysHandler',
        invoke: () => handlers.getCurrentUserPasskeysHandler(),
        service: services.passkeys,
        expected: passkeysResult,
        args: [],
    },
    {
        name: 'beginCurrentUserPasskeyRegistrationHandler',
        invoke: () =>
            handlers.beginCurrentUserPasskeyRegistrationHandler({
                data: reauthentication,
            }),
        service: services.passkeyBegin,
        expected: successResult,
        args: [reauthentication],
    },
    {
        name: 'finishCurrentUserPasskeyRegistrationHandler',
        invoke: () =>
            handlers.finishCurrentUserPasskeyRegistrationHandler({
                data: registration,
            }),
        service: services.passkeyFinish,
        expected: successResult,
        args: [registration],
    },
    {
        name: 'deleteCurrentUserPasskeyHandler',
        invoke: () =>
            handlers.deleteCurrentUserPasskeyHandler({ data: passkeyDeletion }),
        service: services.passkeyDelete,
        expected: successResult,
        args: [passkeyDeletion],
    },
]

const settingsMutationNames = new Set([
    'updateCurrentUserPersonalInfoHandler',
    'updateCurrentUserProfileImageHandler',
    'updateCurrentUserPrimaryColorHandler',
    'resetCurrentUserPrimaryColorHandler',
    'updateCurrentUserThemeModeHandler',
    'updateCurrentUserFontFamilyHandler',
    'updateCurrentUserFontSizeHandler',
    'updateCurrentUserBackgroundHandler',
    'updateCurrentUserBackgroundAppearanceHandler',
    'deleteCurrentUserBackgroundHandler',
])
const settingsMutations = operations.filter((operation) =>
    settingsMutationNames.has(operation.name),
)
const quotaFailures = [
    { name: 'burst', blockedCall: 1, error: new RateLimitError(60) },
    { name: 'daily', blockedCall: 2, error: new RateLimitError(3600) },
    {
        name: 'Valkey',
        blockedCall: 1,
        error: new Error('synthetic Valkey unavailable'),
    },
]
const limitedCases = settingsMutations.flatMap((operation) =>
    quotaFailures.map((failure) => ({ operation, failure })),
)

function expectNoSideEffects() {
    expect(accessMocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(accessMocks.getCurrentUserId).not.toHaveBeenCalled()
    for (const service of Object.values(services)) {
        expect(service).not.toHaveBeenCalled()
    }
}

describe('UserSettings: serverseitige Wartungsgrenze', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        events.length = 0
        rateLimits.reset()
        access.sessionUser.id = userId
        access.sessionUser.sessionHash = 'first-synthetic-session'
        accessMocks.requireAccess.mockImplementation(async function () {
            events.push('access')
            return access
        })
    })

    it.each(settingsMutations)(
        'begrenzt $name mit denselben zwei Accountquoten vor dem Domainaufruf',
        async function (operation) {
            await operation.invoke()
            expect(settingsMutations).toHaveLength(10)
            expect(accessMocks.enforceRateLimit).toHaveBeenNthCalledWith(1, {
                scope: 'current-user-settings-burst',
                identifiers: [userId],
                includeClientIp: false,
                limit: 60,
                windowMs: 60_000,
            })
            expect(accessMocks.enforceRateLimit).toHaveBeenNthCalledWith(2, {
                scope: 'current-user-settings-daily',
                identifiers: [userId],
                includeClientIp: false,
                limit: 300,
                windowMs: 86_400_000,
            })
            expect(events.slice(0, 3)).toEqual([
                'access',
                'rate-limit',
                'rate-limit',
            ])
            expect(
                accessMocks.enforceRateLimit.mock.invocationCallOrder[1],
            ).toBeLessThan(operation.service.mock.invocationCallOrder[0] ?? 0)
            expect(accessMocks.getCurrentUserId).not.toHaveBeenCalled()
            const imageScope =
                operation.name === 'updateCurrentUserProfileImageHandler'
                    ? 'profile-image-upload'
                    : operation.name === 'updateCurrentUserBackgroundHandler'
                      ? 'background-image-upload'
                      : null
            expect(accessMocks.enforceRateLimit).toHaveBeenCalledTimes(
                imageScope ? 3 : 2,
            )
            if (imageScope)
                expect(accessMocks.enforceRateLimit).toHaveBeenNthCalledWith(
                    3,
                    {
                        scope: imageScope,
                        limit: 20,
                        windowMs: 3_600_000,
                    },
                )
        },
    )

    it.each(limitedCases)(
        'stoppt $operation.name bei $failure.name unverändert vor jedem Domainaufruf',
        async function ({ operation, failure }) {
            if (failure.blockedCall === 2)
                accessMocks.enforceRateLimit.mockResolvedValueOnce(undefined)
            accessMocks.enforceRateLimit.mockRejectedValueOnce(failure.error)
            await expect(operation.invoke()).rejects.toBe(failure.error)
            expect(accessMocks.requireAccess).toHaveBeenCalledTimes(1)
            expect(accessMocks.enforceRateLimit).toHaveBeenCalledTimes(
                failure.blockedCall,
            )
            for (const service of Object.values(services))
                expect(service).not.toHaveBeenCalled()
            expect(accessMocks.getCurrentUserId).not.toHaveBeenCalled()
        },
    )

    it('teilt 60 Burstversuche über Aktionen, Sessions und IPs und isoliert einen anderen Account', async function () {
        rateLimits.state.runRealLimiter = true
        await forEachSequentially(
            Array.from({ length: 60 }, (_, index) => index),
            async function (index) {
                await (index % 2 === 0
                    ? handlers.updateCurrentUserThemeModeHandler({
                          data: { themeMode: 'dark' },
                      })
                    : handlers.resetCurrentUserPrimaryColorHandler())
            },
        )
        access.sessionUser.sessionHash = 'second-synthetic-session'
        rateLimits.state.clientIp = '203.0.113.11'
        await expect(
            handlers.updateCurrentUserFontSizeHandler({
                data: { fontSize: 18 },
            }),
        ).rejects.toBeInstanceOf(RateLimitError)
        expect(services.fontSize).not.toHaveBeenCalled()
        expect(rateLimits.state.counters.size).toBe(2)
        expect(rateLimits.getClientIp).not.toHaveBeenCalled()
        expect(accessMocks.getCurrentUserId).not.toHaveBeenCalled()

        access.sessionUser.id = '00000000-0000-4000-8000-000000000002'
        const otherAccountResult: unknown =
            await handlers.updateCurrentUserFontSizeHandler({
                data: { fontSize: 18 },
            })
        expect(otherAccountResult).toBe(successResult)
        expect(rateLimits.state.counters.size).toBe(4)
        expect(services.fontSize).toHaveBeenCalledTimes(1)
    })

    it('begrenzt über mehrere Burstfenster die 301. gemeinsame Tagesmutation', async function () {
        rateLimits.state.runRealLimiter = true
        await forEachSequentially(
            Array.from({ length: 300 }, (_, index) => index),
            async function (index) {
                rateLimits.state.now = Math.floor(index / 60) * 60_001

                await (index % 2 === 0
                    ? handlers.updateCurrentUserThemeModeHandler({
                          data: { themeMode: 'dark' },
                      })
                    : handlers.resetCurrentUserPrimaryColorHandler())
            },
        )
        rateLimits.state.now += 60_001
        await expect(
            handlers.updateCurrentUserPersonalInfoHandler({
                data: personalInfo,
            }),
        ).rejects.toMatchObject({
            name: 'RateLimitError',
            retryAfterSeconds: 86_100,
        })
        expect(services.themeMode).toHaveBeenCalledTimes(150)
        expect(services.resetPrimaryColor).toHaveBeenCalledTimes(150)
        expect(services.personalInfo).not.toHaveBeenCalled()
    })

    it('berechnet für beide GET-Handler keine Mutationsquote', async function () {
        await handlers.getCurrentTwoFactorStatusHandler()
        await handlers.getCurrentUserPasskeysHandler()
        expect(accessMocks.requireAccess).toHaveBeenCalledTimes(2)
        expect(accessMocks.enforceRateLimit).not.toHaveBeenCalled()
        expect(accessMocks.getCurrentUserId).not.toHaveBeenCalled()
    })

    it('erhält Fehler des Domainservices nach erfolgreicher Quotenprüfung', async function () {
        const error = new Error('synthetic domain failure')
        services.personalInfo.mockRejectedValueOnce(error)
        await expect(
            handlers.updateCurrentUserPersonalInfoHandler({
                data: personalInfo,
            }),
        ).rejects.toBe(error)
        expect(accessMocks.enforceRateLimit).toHaveBeenCalledTimes(2)
        expect(services.personalInfo).toHaveBeenCalledTimes(1)
    })

    it('ordnet jedem exportierten Handler einen geprüften Eintrittspunkt zu', function () {
        expect(Object.keys(handlers).toSorted()).toEqual(
            operations.map((operation) => operation.name).toSorted(),
        )
        expect(operations).toHaveLength(19)
    })

    it.each(operations)(
        'blockiert $name vor Rate-Limit und Fachservice',
        async function (operation) {
            const error = new MaintenanceModeError()
            accessMocks.requireAccess.mockRejectedValue(error)

            await expect(operation.invoke()).rejects.toBe(error)

            expect(accessMocks.requireAccess).toHaveBeenCalledTimes(1)
            expectNoSideEffects()
        },
    )

    it.each(operations)(
        'führt $name nach erfolgreicher Freigabe unverändert aus',
        async function (operation) {
            const result = await operation.invoke()

            expect(accessMocks.requireAccess).toHaveBeenCalledTimes(1)
            expect(events[0]).toBe('access')
            expect(operation.service).toHaveBeenCalledTimes(1)
            expect(operation.service).toHaveBeenCalledWith(...operation.args)
            expect(result).toBe(operation.expected)
        },
    )

    it.each([
        { error: new AuthenticationRequiredError() },
        { error: new Error('synthetic policy storage unavailable') },
    ])(
        'führt bei anderen Zugriffsfehlern keinen Fallback aus',
        async function ({ error }) {
            accessMocks.requireAccess.mockRejectedValue(error)

            await expect(
                handlers.requestCurrentUserPasswordResetHandler(),
            ).rejects.toBe(error)

            expectNoSideEffects()
        },
    )

    it('behält nach Freigabe die getrennten IP- und Kontobudgets bei', async function () {
        await handlers.beginCurrentUserTwoFactorSetupHandler({
            data: reauthentication,
        })

        expect(accessMocks.enforceRateLimit).toHaveBeenCalledTimes(2)
        expect(accessMocks.enforceRateLimit).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                scope: 'current-user-two-factor-setup-begin-ip',
            }),
        )
        expect(accessMocks.enforceRateLimit).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                scope: 'current-user-two-factor-setup-begin-account',
                identifiers: [userId],
                includeClientIp: false,
            }),
        )
        expect(events).toEqual([
            'access',
            'rate-limit',
            'session-id',
            'rate-limit',
            'two-factor-begin',
        ])
    })
    it.each(
        operations
            .filter((operation) =>
                [
                    'beginCurrentUserTwoFactorSetupHandler',
                    'confirmCurrentUserTwoFactorSetupHandler',
                    'beginCurrentUserPasskeyRegistrationHandler',
                    'finishCurrentUserPasskeyRegistrationHandler',
                ].includes(operation.name),
            )
            .flatMap((operation) =>
                [1, 2].map((blockedCall) => ({ operation, blockedCall })),
            ),
    )(
        'records a confirmed security quota once before $operation.name (call $blockedCall)',
        async function ({ operation, blockedCall }) {
            const quota = new RateLimitError(10)
            if (blockedCall === 2)
                accessMocks.enforceRateLimit.mockResolvedValueOnce(undefined)
            accessMocks.enforceRateLimit.mockRejectedValueOnce(quota)
            await expect(operation.invoke()).rejects.toBe(quota)
            expect(mockedRejection.mock.calls).toEqual([
                ['reauthentication', 'rate_limited'],
            ])
            expect(operation.service).not.toHaveBeenCalled()
        },
    )

    it('does not count a security quota storage outage as rejected authentication', async function () {
        const failure = new Error('synthetic private Valkey detail')
        accessMocks.enforceRateLimit.mockRejectedValueOnce(failure)
        await expect(
            handlers.beginCurrentUserTwoFactorSetupHandler({
                data: reauthentication,
            }),
        ).rejects.toBe(failure)
        expect(mockedRejection).not.toHaveBeenCalled()
    })
})
