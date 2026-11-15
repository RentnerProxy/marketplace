import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'

import { createReauthenticationProofService } from '@/server/Auth/reauthentication-proof.service.ts'
import {
    passkeyTestDb,
    passkeyTestOrm,
    passkeyTestOtherUserSession,
    passkeyTestSchema,
    passkeyTestSession,
    passkeyTestState,
    passkeyTestUser,
    resetPasskeyTestState,
    PASSKEY_TEST_SESSION_HASH,
} from './passkey-step-up.test.helpers.ts'

import type { PasskeyTestApi } from './passkey-step-up.test.types.ts'

const enqueueSecurityChange = vi.fn(async function (
    _input: SecurityChangeMailInput,
) {})
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueueSecurityChangeMail: enqueueSecurityChange,
}))
const auditCreatedAt = new Date('2024-01-02T03:04:05.678Z')
const publishSessionRevocation = vi.fn(async function (
    _payload: UserSessionsRevokedEvent['payload'],
) {
    passkeyTestState.events.push('sessions:revoked')
})
const publishAudit = vi.fn(async function () {
    passkeyTestState.events.push('audit:publish')
})
const logPostCommitError = vi.fn()
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishUserSessionsRevokedService: publishSessionRevocation,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logError: logPostCommitError,
}))

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

const dbMock = { db: passkeyTestDb, state: passkeyTestState }
const schemaMock = passkeyTestSchema
let currentProof: Awaited<ReturnType<typeof createReauthenticationProofService>>

const serviceMocks = {
    audit: vi.fn(async function (_input: unknown) {}),
    generateRegistrationOptions: vi.fn(async function () {
        return { challenge: 'webauthn-challenge' }
    }),
    getActiveCurrentSessionUser: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    reauthenticateCurrentUserService: vi.fn(),
}

vi.mock('drizzle-orm', function () {
    return passkeyTestOrm
})

vi.mock('@simplewebauthn/server', function () {
    return {
        generateRegistrationOptions: serviceMocks.generateRegistrationOptions,
        verifyRegistrationResponse: serviceMocks.verifyRegistrationResponse,
    }
})

vi.mock('@/server/Auth/Passkey/config.service.ts', function () {
    return {
        getPasskeyConfig: vi.fn(function () {
            return {
                origin: 'https://example.test',
                rpID: 'example.test',
                rpName: 'Test App',
            }
        }),
    }
})

vi.mock('@/db', function () {
    return { db: dbMock.db }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('@/lib/Auth/passkeys.ts', function () {
    return {
        createWebAuthnUserId: vi.fn(function () {
            return 'webauthn-user-id'
        }),
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            return { actorUserId, route: null, method: 'POST' }
        },
        async writeAuditLogInTransactionService(
            transaction: PasskeyTestApi,
            input: Record<string, unknown>,
        ) {
            await serviceMocks.audit(input)
            const receipt = transaction.recordAudit(input)
            receipt.createdAt.setTime(auditCreatedAt.getTime())
            return receipt
        },
        publishCommittedAuditLogService: publishAudit,
    }
})

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getActiveCurrentSessionUser: serviceMocks.getActiveCurrentSessionUser,
        getCurrentUserSettingsSession: vi.fn(),
    }
})

vi.mock('@/server/Auth/Passkey/credential.ts', function () {
    return {
        toStoredTransports: vi.fn(function () {
            return []
        }),
    }
})

vi.mock('@/server/Auth/reauthentication.service.ts', function () {
    return {
        reauthenticateCurrentUserService:
            serviceMocks.reauthenticateCurrentUserService,
    }
})

const {
    beginCurrentUserPasskeyRegistrationService,
    finishCurrentUserPasskeyRegistrationService,
} = await import('@/server/Auth/Passkey/registration.service.ts')
const { deleteCurrentUserPasskeyService } =
    await import('@/server/Auth/Passkey/management.service.ts')

const mockedGenerateRegistrationOptions = generateRegistrationOptions as Mock<
    typeof generateRegistrationOptions
>
const mockedGetActiveCurrentSessionUser = getActiveCurrentSessionUser as Mock<
    typeof getActiveCurrentSessionUser
>
const mockedVerifyRegistrationResponse = verifyRegistrationResponse as Mock<
    typeof verifyRegistrationResponse
>

const currentUser = passkeyTestUser
const currentSession = passkeyTestSession

async function beginRegistration() {
    const result = await beginCurrentUserPasskeyRegistrationService({
        reauthentication: {
            method: 'password',
            credential: 'current-password',
        },
    })
    if (!result.success) {
        throw new Error('Passkey-Registrierung wurde nicht gestartet.')
    }
    return result
}

function createFinishInput(registration: {
    challengeId: string
    registrationToken: string
}) {
    return {
        challengeId: registration.challengeId,
        registrationToken: registration.registrationToken,
        response: {
            id: 'credential-id',
            rawId: 'credential-id',
            response: {
                clientDataJSON: 'AQID',
                attestationObject: 'BAUG',
            },
            clientExtensionResults: {},
            type: 'public-key' as const,
        },
    }
}

describe('Passkey-Registrierung mit Session- und Challenge-Binding', function () {
    beforeEach(async function () {
        vi.clearAllMocks()
        enqueueSecurityChange.mockReset().mockResolvedValue(undefined)
        publishSessionRevocation
            .mockReset()
            .mockImplementation(async function () {
                passkeyTestState.events.push('sessions:revoked')
            })
        publishAudit.mockReset().mockImplementation(async function () {
            passkeyTestState.events.push('audit:publish')
        })
        logPostCommitError.mockReset()
        resetPasskeyTestState()
        currentProof = await createReauthenticationProofService(
            currentUser,
            null,
            PASSKEY_TEST_SESSION_HASH,
        )
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: true,
            currentUser,
            proof: currentProof,
        })
        mockedGetActiveCurrentSessionUser.mockResolvedValue(currentSession)
        mockedVerifyRegistrationResponse.mockResolvedValue({
            verified: true,
            registrationInfo: {
                fmt: 'none',
                aaguid: '00000000-0000-0000-0000-000000000000',
                credential: {
                    id: 'credential-id',
                    publicKey: new Uint8Array([255, 1, 2, 3, 254]).subarray(
                        1,
                        4,
                    ),
                    counter: 0,
                },
                credentialType: 'public-key',
                attestationObject: new Uint8Array(),
                userVerified: true,
                credentialDeviceType: 'singleDevice',
                credentialBackedUp: false,
                origin: 'https://example.test',
                rpID: 'example.test',
            },
        })
    })

    it('erstellt für die aktuelle Sitzung eine Challenge mit gehashtem Flow-Token', async function () {
        const result = await beginRegistration()

        expect(result).toMatchObject({
            success: true,
            challengeId: 'challenge-1',
        })
        expect(mockedGetActiveCurrentSessionUser).not.toHaveBeenCalled()
        expect(
            serviceMocks.reauthenticateCurrentUserService,
        ).toHaveBeenCalledWith({
            method: 'password',
            credential: 'current-password',
        })
        expect(dbMock.state.insertValues).toContainEqual(
            expect.objectContaining({
                identifier: await createTokenHash(
                    JSON.stringify([
                        'passkey-registration-v3',
                        PASSKEY_TEST_SESSION_HASH,
                        currentProof.credentialVersion,
                        result.registrationToken,
                    ]),
                ),
                type: 'registration-policy-bound-v4',
                userId: 'user-1',
            }),
        )
        expect(JSON.stringify(dbMock.state.insertValues)).not.toContain(
            result.registrationToken,
        )
        expect(mockedGenerateRegistrationOptions).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(mockedGenerateRegistrationOptions).toHaveBeenCalledWith(
            expect.objectContaining({
                userID: Buffer.from('webauthn-user-id', 'base64url'),
                authenticatorSelection: {
                    residentKey: 'required',
                    userVerification: 'required',
                },
            }),
        )
    })

    it('erstellt ohne erfolgreichen bisherigen Faktor weder Challenge noch Passkey', async function () {
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        const result = await beginCurrentUserPasskeyRegistrationService({
            reauthentication: {
                method: 'password',
                credential: 'wrong-password',
            },
        })
        expect(result).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        expect(dbMock.db.insert).not.toHaveBeenCalled()
        expect(mockedGenerateRegistrationOptions).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(mockedGetActiveCurrentSessionUser).not.toHaveBeenCalled()
    })

    it('verwirft eine während der Bestätigung widerrufene Session', async function () {
        dbMock.state.rows.sessions = []
        expect(
            await beginCurrentUserPasskeyRegistrationService({
                reauthentication: {
                    method: 'password',
                    credential: 'current-password',
                },
            }),
        ).toMatchObject({ success: false })
        expect(dbMock.db.insert).not.toHaveBeenCalled()
    })

    it('akzeptiert keine Bestätigung für einen anderen Benutzer', async function () {
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: true,
            currentUser: { ...currentUser, id: 'another-user' },
            proof: { ...currentProof, userId: 'another-user' },
        })
        expect(
            await beginCurrentUserPasskeyRegistrationService({
                reauthentication: {
                    method: 'password',
                    credential: 'current-password',
                },
            }),
        ).toMatchObject({ success: false })
        expect(dbMock.db.insert).not.toHaveBeenCalled()
    })

    it('konsumiert beim Finish nur die Challenge mit passendem Token-Hash', async function () {
        const registration = await beginRegistration()
        const result = await finishCurrentUserPasskeyRegistrationService(
            createFinishInput({
                ...registration,
                registrationToken: crypto.randomUUID(),
            }),
        )
        expect(result).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(dbMock.state.rows.challenges).toHaveLength(1)
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('schließt Begin und Finish in derselben Session erfolgreich und nur einmal ab', async function () {
        const registration = await beginRegistration()
        const input = createFinishInput(registration)

        expect(
            await finishCurrentUserPasskeyRegistrationService(input),
        ).toEqual({ success: true })
        expect(mockedVerifyRegistrationResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedChallenge: registration.options.challenge,
                expectedOrigin: 'https://example.test',
                expectedRPID: 'example.test',
                requireUserVerification: true,
            }),
        )
        expect(dbMock.state.rows.challenges).toHaveLength(0)
        expect(dbMock.state.rows.credentials).toEqual([
            expect.objectContaining({
                userId: currentUser.id,
                credentialId: 'credential-id',
                webauthnUserId: 'webauthn-user-id',
                publicKey: 'AQID',
            }),
        ])

        expect(
            await finishCurrentUserPasskeyRegistrationService(input),
        ).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).toHaveBeenCalledTimes(1)
        expect(dbMock.state.rows.credentials).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('verhindert die Übernahme einer Challenge durch eine andere Session desselben Benutzers', async function () {
        const registration = await beginRegistration()
        const input = createFinishInput(registration)
        dbMock.state.rows.sessions.push({
            id: 'b'.repeat(64),
            userId: currentUser.id,
            expiresAt: currentSession.expiresAt,
        })
        mockedGetActiveCurrentSessionUser.mockResolvedValue({
            ...currentSession,
            sessionHash: 'b'.repeat(64),
        })

        expect(
            await finishCurrentUserPasskeyRegistrationService(input),
        ).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(dbMock.state.rows.challenges).toHaveLength(1)
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()

        mockedGetActiveCurrentSessionUser.mockResolvedValue(currentSession)
        expect(
            await finishCurrentUserPasskeyRegistrationService(input),
        ).toEqual({ success: true })
        expect(dbMock.state.rows.challenges).toHaveLength(0)
        expect(dbMock.state.rows.credentials).toHaveLength(1)
    })

    it.each(['legacy', 'session-bound'] as const)(
        'lehnt alte registration-Challenges auch mit Tokenformat %s ab',
        async function (tokenFormat) {
            const registrationToken = crypto.randomUUID()
            dbMock.state.rows.challenges.push({
                id: 'legacy-challenge',
                userId: currentUser.id,
                identifier: await createTokenHash(
                    tokenFormat === 'legacy'
                        ? registrationToken
                        : `passkey-registration-v2:session-hash:${registrationToken}`,
                ),
                type: 'registration',
                expiresAt: new Date(Date.now() + 60_000),
                challenge: 'legacy-webauthn-challenge',
                webauthnUserId: 'webauthn-user-id',
            })

            const result = await finishCurrentUserPasskeyRegistrationService(
                createFinishInput({
                    challengeId: 'legacy-challenge',
                    registrationToken,
                }),
            )

            expect(result).toMatchObject({ success: false })
            expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
            expect(dbMock.state.rows.credentials).toHaveLength(0)
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
            expect(dbMock.state.rows.challenges).toHaveLength(1)
        },
    )

    it('lehnt eine abgelaufene Challenge trotz richtiger Session und richtigem Token ab', async function () {
        const registration = await beginRegistration()
        dbMock.state.rows.challenges[0].expiresAt = new Date(Date.now() - 1)

        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('rejects a previous preferred-resident registration challenge', async function () {
        const registration = await beginRegistration()
        dbMock.state.rows.challenges[0].type = 'registration-reauthenticated-v2'
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it.each([null, undefined, ''])(
        'rejects a registration without the original user handle (%s)',
        async function (webauthnUserId) {
            const registration = await beginRegistration()
            dbMock.state.rows.challenges[0].webauthnUserId = webauthnUserId
            expect(
                await finishCurrentUserPasskeyRegistrationService(
                    createFinishInput(registration),
                ),
            ).toMatchObject({ success: false })
            expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
            expect(dbMock.state.rows.credentials).toHaveLength(0)
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )
})

async function useMfaProof() {
    const user = { ...currentUser, isTwoFactorEnabled: true }
    dbMock.state.rows.users[0] = user
    dbMock.state.rows.factors = [
        {
            id: 'factor-1',
            userId: user.id,
            verified: true,
            secret: 'synthetic-replay-state-1',
        },
    ]
    currentProof = await createReauthenticationProofService(
        user,
        'factor-1',
        PASSKEY_TEST_SESSION_HASH,
    )
    serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
        success: true,
        currentUser: user,
        proof: currentProof,
    })
}

describe('Passkey credential-version guards', function () {
    beforeEach(async function () {
        vi.clearAllMocks()
        enqueueSecurityChange.mockReset().mockResolvedValue(undefined)
        publishSessionRevocation
            .mockReset()
            .mockImplementation(async function () {
                passkeyTestState.events.push('sessions:revoked')
            })
        publishAudit.mockReset().mockImplementation(async function () {
            passkeyTestState.events.push('audit:publish')
        })
        logPostCommitError.mockReset()
        resetPasskeyTestState()
        currentProof = await createReauthenticationProofService(
            currentUser,
            null,
            PASSKEY_TEST_SESSION_HASH,
        )
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: true,
            currentUser,
            proof: currentProof,
        })
        mockedGetActiveCurrentSessionUser.mockResolvedValue(currentSession)
        mockedVerifyRegistrationResponse.mockResolvedValue({
            verified: true,
            registrationInfo: {
                fmt: 'none',
                aaguid: '00000000-0000-0000-0000-000000000000',
                credential: {
                    id: 'credential-id',
                    publicKey: new Uint8Array([1, 2, 3]),
                    counter: 0,
                },
                credentialType: 'public-key',
                attestationObject: new Uint8Array(),
                userVerified: true,
                credentialDeviceType: 'singleDevice',
                credentialBackedUp: false,
                origin: 'https://example.test',
                rpID: 'example.test',
            },
        })
    })

    it('rejects a password change between credential verification and the User lock', async function () {
        dbMock.state.beforeUserLock = function () {
            dbMock.state.rows.users[0].passwordHash = 'changed-password-hash'
        }
        expect(
            await beginCurrentUserPasskeyRegistrationService({
                reauthentication: {
                    method: 'password',
                    credential: 'current-password',
                },
            }),
        ).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.',
        })
        expect(dbMock.state.rows.challenges).toHaveLength(0)
        expect(mockedGenerateRegistrationOptions).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('rejects expired immediate proof without creating a registration challenge', async function () {
        currentProof.expiresAt = Date.now() - 1
        expect(
            await beginCurrentUserPasskeyRegistrationService({
                reauthentication: {
                    method: 'password',
                    credential: 'current-password',
                },
            }),
        ).toMatchObject({ success: false })
        expect(dbMock.state.rows.challenges).toHaveLength(0)
        expect(mockedGenerateRegistrationOptions).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it.each([
        'password reset',
        'MFA enabled',
        'MFA disabled',
        'factor replaced',
        'session revoked',
        'session expired',
        'inactive account',
    ])(
        'rejects finish after %s with a generic restart response',
        async function (change) {
            if (change === 'MFA disabled' || change === 'factor replaced')
                await useMfaProof()
            const registration = await beginRegistration()
            if (change === 'password reset')
                dbMock.state.rows.users[0].passwordHash =
                    'changed-password-hash'
            else if (change === 'MFA enabled') {
                dbMock.state.rows.users[0].isTwoFactorEnabled = true
                dbMock.state.rows.factors = [
                    {
                        id: 'new-factor',
                        userId: currentUser.id,
                        verified: true,
                    },
                ]
            } else if (change === 'MFA disabled') {
                dbMock.state.rows.users[0].isTwoFactorEnabled = false
                dbMock.state.rows.factors = []
            } else if (change === 'factor replaced')
                dbMock.state.rows.factors[0].id = 'factor-2'
            else if (change === 'session revoked')
                dbMock.state.rows.sessions = []
            else if (change === 'session expired')
                dbMock.state.rows.sessions[0].expiresAt = new Date(
                    Date.now() - 1,
                )
            else dbMock.state.rows.users[0].isActive = false
            expect(
                await finishCurrentUserPasskeyRegistrationService(
                    createFinishInput(registration),
                ),
            ).toEqual({
                success: false,
                error: 'Passkey-Registrierung ist abgelaufen. Bitte starte erneut.',
            })
            expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
            expect(dbMock.state.rows.credentials).toHaveLength(0)
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
            expect(dbMock.state.rows.challenges).toHaveLength(1)
        },
    )

    it('allows TOTP replay-state rotation on the same enrolled factor between begin and finish', async function () {
        await useMfaProof()
        const registration = await beginRegistration()
        dbMock.state.rows.factors[0].secret = 'synthetic-replay-state-2'
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toEqual({ success: true })
    })

    it('rejects the former v3 challenge even if its identifier is replaced with a current valid hash', async function () {
        const registration = await beginRegistration()
        dbMock.state.rows.challenges[0].type = 'registration-reauth-resident-v3'
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toMatchObject({ success: false })
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('serializes concurrent finishes so one ceremony inserts at most one passkey', async function () {
        const registration = await beginRegistration()
        const input = createFinishInput(registration)
        const results = await Promise.all([
            finishCurrentUserPasskeyRegistrationService(input),
            finishCurrentUserPasskeyRegistrationService(input),
        ])
        expect(
            results.filter(function (result) {
                return result.success
            }),
        ).toHaveLength(1)
        expect(mockedVerifyRegistrationResponse).toHaveBeenCalledTimes(1)
        expect(dbMock.state.rows.credentials).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(dbMock.state.rows.challenges).toHaveLength(0)
    })

    it.each(['false', 'throw'])(
        'consumes a matched challenge after WebAuthn verification returns %s',
        async function (outcome) {
            const registration = await beginRegistration()
            if (outcome === 'throw')
                mockedVerifyRegistrationResponse.mockRejectedValueOnce(
                    new Error('synthetic attestation details'),
                )
            else
                mockedVerifyRegistrationResponse.mockResolvedValueOnce({
                    verified: false,
                })
            const input = createFinishInput(registration)
            expect(
                await finishCurrentUserPasskeyRegistrationService(input),
            ).toEqual({
                success: false,
                error: 'Passkey konnte nicht bestätigt werden.',
            })
            expect(dbMock.state.rows.challenges).toHaveLength(0)
            expect(
                await finishCurrentUserPasskeyRegistrationService(input),
            ).toMatchObject({ success: false })
            expect(mockedVerifyRegistrationResponse).toHaveBeenCalledTimes(1)
            expect(dbMock.state.rows.credentials).toHaveLength(0)
            expect(enqueueSecurityChange).not.toHaveBeenCalled()
            expect(publishSessionRevocation).not.toHaveBeenCalled()
        },
    )

    it('restores the consumed challenge and removes the staged credential if mandatory audit fails', async function () {
        const registration = await beginRegistration()
        const before = structuredClone(dbMock.state.rows)
        serviceMocks.audit.mockRejectedValueOnce(
            new Error('Synthetic audit failure'),
        )
        await expect(
            finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).rejects.toThrow('Synthetic audit failure')
        expect(dbMock.state.rows).toEqual(before)
        expect(dbMock.state.events).toContain('insert:credentials:tx')
        expect(dbMock.state.events.at(-1)).toBe('transaction:rollback')
        expect(dbMock.state.events).not.toContain('audit:publish')
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('rolls back challenge consumption when credential insertion fails', async function () {
        const registration = await beginRegistration()
        dbMock.state.failInsertTable = 'credentials'
        await expect(
            finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).rejects.toThrow('Synthetic Passkey insert failure')
        expect(dbMock.state.rows.challenges).toHaveLength(1)
        expect(dbMock.state.rows.credentials).toHaveLength(0)
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        expect(dbMock.state.events.at(-1)).toBe('transaction:rollback')
    })

    it('keeps every ceremony mutation under policy locks and omits internal proof from responses', async function () {
        const registration = await beginRegistration()
        expect(Object.keys(registration).toSorted()).toEqual([
            'challengeId',
            'options',
            'registrationToken',
            'success',
        ])
        expect(JSON.stringify(registration)).not.toContain(
            currentProof.credentialVersion,
        )
        expect(JSON.stringify(registration)).not.toContain(
            PASSKEY_TEST_SESSION_HASH,
        )
        dbMock.state.events = []
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toEqual({ success: true })
        expect(dbMock.state.events).toEqual([
            'transaction:start',
            'lock:users',
            'lock:sessions',
            'lock:factors',
            'delete:challenges:tx',
            'insert:credentials:tx',
            'delete:sessions:tx',
            'audit:tx',
            'transaction:commit',
            'sessions:revoked',
            'audit:publish',
        ])
        expect(dbMock.db.insert).not.toHaveBeenCalled()
        expect(passkeyTestState.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(passkeyTestState.rows.auditLogs[0]).toMatchObject({
            newValues: { sessionsRevoked: 'all' },
        })
        expect(publishSessionRevocation.mock.calls).toEqual([
            [
                {
                    userId: passkeyTestUser.id,
                    revokedAt: auditCreatedAt.toISOString(),
                },
            ],
        ])
    })
    it.each(['begin', 'finish'] as const)(
        'records invalid %s session/proof exactly once across nested validators',
        async function (stage) {
            if (stage === 'begin') {
                currentProof.expiresAt = Date.now() - 1
                expect(
                    (
                        await beginCurrentUserPasskeyRegistrationService({
                            reauthentication: {
                                method: 'password',
                                credential: 'private',
                            },
                        })
                    ).success,
                ).toBe(false)
            } else {
                const registration = await beginRegistration()
                dbMock.state.rows.sessions = []
                expect(
                    (
                        await finishCurrentUserPasskeyRegistrationService(
                            createFinishInput(registration),
                        )
                    ).success,
                ).toBe(false)
            }
            expect(mockedRejection.mock.calls).toEqual([
                ['reauthentication', 'stale_proof'],
            ])
        },
    )

    it('records expired registration binding once without logging challenge details', async function () {
        const registration = await beginRegistration()
        const input = {
            ...createFinishInput(registration),
            registrationToken: 'foreign-private-token',
        }
        expect(
            (await finishCurrentUserPasskeyRegistrationService(input)).success,
        ).toBe(false)
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'stale_proof'],
        ])
    })

    it('records rejected attestation once and excludes subsequent storage failures', async function () {
        const registration = await beginRegistration()
        mockedVerifyRegistrationResponse.mockResolvedValueOnce({
            verified: false,
        })
        expect(
            (
                await finishCurrentUserPasskeyRegistrationService(
                    createFinishInput(registration),
                )
            ).success,
        ).toBe(false)
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'invalid_passkey'],
        ])
        mockedRejection.mockClear()
        const second = await beginRegistration()
        serviceMocks.audit.mockRejectedValueOnce(
            new Error('synthetic audit storage failure'),
        )
        await expect(
            finishCurrentUserPasskeyRegistrationService(
                createFinishInput(second),
            ),
        ).rejects.toThrow()
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('queues one addition after commit using the email reread at Finish and its audit receipt', async function () {
        const registration = await beginRegistration()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
        const recipient = 'current-owner@example.test'
        const observedEvents: Array<Array<string>> = []
        const observedRows: Array<typeof passkeyTestState.rows> = []
        dbMock.state.beforeUserLock = function () {
            dbMock.state.rows.users[0].email = recipient
        }
        dbMock.state.events = []
        enqueueSecurityChange.mockImplementationOnce(async function () {
            observedEvents.push([...dbMock.state.events])
            observedRows.push(structuredClone(dbMock.state.rows))
        })

        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toEqual({ success: true })
        expect(observedEvents).toHaveLength(1)
        expect(observedEvents[0]?.at(-1)).toBe('transaction:commit')
        expect(observedEvents[0]).toContain('audit:tx')
        expect(observedEvents[0]?.indexOf('audit:tx')).toBeLessThan(
            observedEvents[0]?.indexOf('transaction:commit') ?? -1,
        )
        expect(observedRows[0]?.credentials).toEqual([
            expect.objectContaining({
                userId: currentUser.id,
                credentialId: 'credential-id',
            }),
        ])
        expect(observedRows[0]?.challenges).toHaveLength(0)
        expect(observedRows[0]?.auditLogs).toEqual([
            expect.objectContaining({
                id: 'audit-1',
                createdAt: auditCreatedAt,
                action: 'user.passkey_added',
            }),
        ])
        expect(enqueueSecurityChange.mock.calls).toEqual([
            [
                {
                    to: recipient,
                    change: 'passkey_added',
                    changedAt: auditCreatedAt.toISOString(),
                    auditEventId: 'audit-1',
                },
            ],
        ])
        expect(currentUser.email).toBe('kevin@example.test')
        expect(dbMock.state.events.at(-1)).toBe('audit:publish')
    })

    it('does not queue an addition for an already enrolled credential', async function () {
        const first = await beginRegistration()
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(first),
            ),
        ).toEqual({ success: true })
        await expect(beginRegistration()).rejects.toThrow(
            'Passkey-Registrierung wurde nicht gestartet.',
        )
        expect(dbMock.state.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        const newSessionHash = '2'.repeat(64)
        dbMock.state.rows.sessions.push({
            id: newSessionHash,
            userId: currentUser.id,
            expiresAt: currentSession.expiresAt,
        })
        currentProof = await createReauthenticationProofService(
            currentUser,
            null,
            newSessionHash,
        )
        serviceMocks.reauthenticateCurrentUserService.mockResolvedValue({
            success: true,
            currentUser,
            proof: currentProof,
        })
        mockedGetActiveCurrentSessionUser.mockResolvedValue({
            ...currentSession,
            sessionHash: newSessionHash,
        })
        const beforeDuplicate = structuredClone(dbMock.state.rows.sessions)
        const second = await beginRegistration()
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(second),
            ),
        ).toEqual({
            success: false,
            error: 'Dieser Passkey ist bereits eingerichtet.',
        })
        expect(dbMock.state.rows.sessions).toEqual(beforeDuplicate)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        expect(dbMock.state.rows.credentials).toHaveLength(1)
        expect(dbMock.state.rows.auditLogs).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('invalidates a pending registration when another passkey change revokes its session', async function () {
        const registration = await beginRegistration()
        const existingPasskey = {
            id: '22222222-2222-4222-8222-222222222222',
            userId: currentUser.id,
        }
        dbMock.state.rows.credentials.push(existingPasskey)
        expect(
            await deleteCurrentUserPasskeyService({
                passkeyId: existingPasskey.id,
                reauthentication: {
                    method: 'password',
                    credential: 'current-password',
                },
            }),
        ).toEqual({ success: true })
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toMatchObject({ success: false })
        expect(dbMock.state.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(dbMock.state.rows.credentials).toEqual([])
        expect(dbMock.state.rows.challenges).toHaveLength(1)
        expect(dbMock.state.rows.auditLogs).toHaveLength(1)
        expect(mockedVerifyRegistrationResponse).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
    })

    it('rolls back the credential and all sessions when session deletion fails', async function () {
        const registration = await beginRegistration()
        const before = structuredClone(dbMock.state.rows)
        dbMock.state.failDeleteTable = 'sessions'
        await expect(
            finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).rejects.toThrow('Synthetic Passkey delete failure')
        expect(dbMock.state.rows).toEqual(before)
        expect(dbMock.state.events.at(-1)).toBe('transaction:rollback')
        expect(serviceMocks.audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('attempts revocation after committed mail even if later audit publication fails', async function () {
        const registration = await beginRegistration()
        enqueueSecurityChange.mockImplementationOnce(async function () {
            expect(dbMock.state.rows.sessions).toEqual([
                passkeyTestOtherUserSession,
            ])
            expect(dbMock.state.events.at(-1)).toBe('transaction:commit')
            dbMock.state.events.push('notification')
        })
        publishAudit.mockImplementationOnce(async function () {
            dbMock.state.events.push('audit:publish')
            throw new Error('Synthetic audit publication failure')
        })
        await expect(
            finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).rejects.toThrow('Synthetic audit publication failure')
        expect(dbMock.state.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(dbMock.state.rows.auditLogs).toHaveLength(1)
        expect(dbMock.state.events.slice(-4)).toEqual([
            'transaction:commit',
            'notification',
            'sessions:revoked',
            'audit:publish',
        ])
        expect(publishSessionRevocation.mock.calls).toEqual([
            [
                {
                    userId: passkeyTestUser.id,
                    revokedAt: auditCreatedAt.toISOString(),
                },
            ],
        ])
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(dbMock.state.events).not.toContain('transaction:rollback')
    })

    it('keeps the committed factor change and audit publication when revocation publishing fails', async function () {
        const registration = await beginRegistration()
        const failure = new Error('Synthetic realtime outage')
        publishSessionRevocation.mockRejectedValueOnce(failure)
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toEqual({ success: true })
        expect(dbMock.state.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(dbMock.state.rows.auditLogs).toHaveLength(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(publishAudit).toHaveBeenCalledTimes(1)
        expect(logPostCommitError.mock.calls).toEqual([
            [
                'auth.factor_change.realtime_revoke_failed',
                failure,
                { auditLogId: 'audit-1' },
            ],
        ])
        expect(dbMock.state.events).not.toContain('transaction:rollback')
    })
    it('keeps the committed addition and public success if notification queueing fails', async function () {
        const registration = await beginRegistration()
        enqueueSecurityChange.mockRejectedValueOnce(
            new Error('synthetic queue outage'),
        )
        expect(
            await finishCurrentUserPasskeyRegistrationService(
                createFinishInput(registration),
            ),
        ).toEqual({ success: true })
        expect(dbMock.state.rows.credentials).toHaveLength(1)
        expect(dbMock.state.rows.challenges).toHaveLength(0)
        expect(dbMock.state.rows.auditLogs).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        expect(dbMock.state.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(dbMock.state.events).toContain('transaction:commit')
        expect(dbMock.state.events).not.toContain('transaction:rollback')
        expect(dbMock.state.events.at(-1)).toBe('audit:publish')
    })
})
