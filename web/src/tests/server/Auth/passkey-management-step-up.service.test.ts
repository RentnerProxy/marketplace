import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createReauthenticationProofService } from '@/server/Auth/reauthentication-proof.service.ts'
import {
    passkeyTestDb,
    passkeyTestOrm,
    passkeyTestOtherUserSession,
    passkeyTestSchema,
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

const remainingSignIn = vi.fn(
    async (_transaction: unknown, _input: unknown) => false,
)
vi.mock('@/server/Auth/remaining-sign-in.service.ts', () => ({
    hasRemainingSignInMethodService: remainingSignIn,
}))
const reauthenticate = vi.fn()
const audit = vi.fn(async function (_input: unknown) {
    return undefined
})
vi.mock('drizzle-orm', function () {
    return passkeyTestOrm
})
vi.mock('@/db', function () {
    return { db: passkeyTestDb }
})
vi.mock('@/db/schema.ts', function () {
    return passkeyTestSchema
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
            await audit(input)
            const receipt = transaction.recordAudit(input)
            receipt.createdAt.setTime(auditCreatedAt.getTime())
            return receipt
        },
        publishCommittedAuditLogService: publishAudit,
    }
})
vi.mock('@/server/Auth/currentSession.ts', function () {
    return { getCurrentUserSettingsSession: vi.fn() }
})
vi.mock('@/server/Auth/reauthentication.service.ts', function () {
    return { reauthenticateCurrentUserService: reauthenticate }
})

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const { deleteCurrentUserPasskeyService } =
    await import('@/server/Auth/Passkey/management.service.ts')

const input = {
    passkeyId: '11111111-1111-4111-8111-111111111111',
    reauthentication: {
        method: 'password' as const,
        credential: 'current-password',
    },
}
let proof: Awaited<ReturnType<typeof createReauthenticationProofService>>

beforeEach(async function () {
    vi.clearAllMocks()
    remainingSignIn.mockReset().mockResolvedValue(false)
    enqueueSecurityChange.mockReset().mockResolvedValue(undefined)
    publishSessionRevocation.mockReset().mockImplementation(async function () {
        passkeyTestState.events.push('sessions:revoked')
    })
    publishAudit.mockReset().mockImplementation(async function () {
        passkeyTestState.events.push('audit:publish')
    })
    logPostCommitError.mockReset()
    resetPasskeyTestState()
    proof = await createReauthenticationProofService(
        passkeyTestUser,
        null,
        PASSKEY_TEST_SESSION_HASH,
    )
    reauthenticate.mockResolvedValue({
        success: true,
        currentUser: passkeyTestUser,
        proof,
    })
    passkeyTestState.rows.credentials = [
        { id: input.passkeyId, userId: passkeyTestUser.id },
        { id: 'other-passkey', userId: 'other-user' },
    ]
})

describe('Passkey deletion with locked step-up proof', function () {
    it('restores the deleted owned passkey when mandatory audit insertion fails', async function () {
        const before = structuredClone(passkeyTestState.rows)
        audit.mockRejectedValueOnce(new Error('Synthetic audit failure'))
        await expect(deleteCurrentUserPasskeyService(input)).rejects.toThrow(
            'Synthetic audit failure',
        )
        expect(passkeyTestState.rows).toEqual(before)
        expect(passkeyTestState.events).toContain('delete:credentials:tx')
        expect(passkeyTestState.events.at(-1)).toBe('transaction:rollback')
        expect(passkeyTestState.events).not.toContain('audit:publish')
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('does not delete or audit after failed credential verification', async function () {
        reauthenticate.mockResolvedValue({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen.',
        })
        expect(passkeyTestDb.transaction).not.toHaveBeenCalled()
        expect(passkeyTestState.rows.credentials).toHaveLength(2)
        expect(audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('locks current user/session/factor before deleting exactly the owned passkey and atomically auditing it', async function () {
        const result = await deleteCurrentUserPasskeyService(input)
        expect(result).toEqual({ success: true })
        expect(passkeyTestState.rows.credentials).toEqual([
            { id: 'other-passkey', userId: 'other-user' },
        ])
        expect(passkeyTestState.events).toEqual([
            'transaction:start',
            'lock:users',
            'lock:sessions',
            'lock:factors',
            'delete:credentials:tx',
            'delete:sessions:tx',
            'audit:tx',
            'transaction:commit',
            'sessions:revoked',
            'audit:publish',
        ])
        expect(passkeyTestDb.delete).not.toHaveBeenCalled()
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

        expect(audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'user.passkey_deleted',
                actorUserId: passkeyTestUser.id,
            }),
        )
        expect(JSON.stringify(result)).not.toContain(proof.credentialVersion)
        expect(JSON.stringify(audit.mock.calls)).not.toContain(
            passkeyTestUser.passwordHash,
        )
    })

    it('rejects a different owner even with valid step-up', async function () {
        const beforeSessions = structuredClone(passkeyTestState.rows.sessions)
        expect(
            await deleteCurrentUserPasskeyService({
                ...input,
                passkeyId: 'other-passkey',
            }),
        ).toEqual({ success: false, error: 'Passkey wurde nicht gefunden.' })
        expect(passkeyTestState.rows.credentials).toHaveLength(2)
        expect(passkeyTestState.rows.sessions).toEqual(beforeSessions)
        expect(audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it.each([
        'password reset',
        'MFA enabled',
        'session revoked',
        'session expired',
        'proof expired',
    ])('rejects stale proof after %s before deletion', async function (change) {
        if (change === 'proof expired') proof.expiresAt = Date.now() - 1
        passkeyTestState.beforeUserLock = function () {
            if (change === 'password reset')
                passkeyTestState.rows.users[0].passwordHash =
                    'changed-password-hash'
            else if (change === 'MFA enabled') {
                passkeyTestState.rows.users[0].isTwoFactorEnabled = true
                passkeyTestState.rows.factors = [
                    {
                        id: 'new-factor',
                        userId: passkeyTestUser.id,
                        verified: true,
                    },
                ]
            } else if (change === 'session revoked')
                passkeyTestState.rows.sessions = []
            else if (change === 'session expired')
                passkeyTestState.rows.sessions[0].expiresAt = new Date(
                    Date.now() - 1,
                )
            else proof.expiresAt = Date.now() - 1
        }
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.',
        })
        expect(passkeyTestState.rows.credentials).toHaveLength(2)
        expect(passkeyTestState.events).not.toContain('delete:credentials:tx')
        expect(audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('rejects a replaced verified MFA factor but permits replay-state rotation on the same factor', async function () {
        const mfaUser = { ...passkeyTestUser, isTwoFactorEnabled: true }
        passkeyTestState.rows.users[0] = mfaUser
        passkeyTestState.rows.factors = [
            {
                id: 'factor-1',
                userId: mfaUser.id,
                verified: true,
                secret: 'synthetic-original-replay-state',
            },
        ]
        proof = await createReauthenticationProofService(
            mfaUser,
            'factor-1',
            PASSKEY_TEST_SESSION_HASH,
        )
        reauthenticate.mockResolvedValue({
            success: true,
            currentUser: mfaUser,
            proof,
        })
        passkeyTestState.rows.factors[0].id = 'factor-2'
        expect(await deleteCurrentUserPasskeyService(input)).toMatchObject({
            success: false,
        })
        expect(passkeyTestState.rows.credentials).toHaveLength(2)
        passkeyTestState.rows.factors[0].id = 'factor-1'
        passkeyTestState.rows.factors[0].secret = 'synthetic-next-replay-state'
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(audit).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('permits one of two concurrent deletions and never audits the missing second row', async function () {
        const results = await Promise.all([
            deleteCurrentUserPasskeyService(input),
            deleteCurrentUserPasskeyService(input),
        ])
        expect(
            results.filter(function (result) {
                return result.success
            }),
        ).toHaveLength(1)
        expect(passkeyTestState.rows.credentials).toHaveLength(1)
        expect(audit).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('queues one removal after commit using the email reread under the User lock and its audit receipt', async function () {
        const recipient = 'current-owner@example.test'
        const observedEvents: Array<Array<string>> = []
        const observedRows: Array<typeof passkeyTestState.rows> = []
        passkeyTestState.beforeUserLock = function () {
            passkeyTestState.rows.users[0].email = recipient
        }
        enqueueSecurityChange.mockImplementationOnce(async function () {
            observedEvents.push([...passkeyTestState.events])
            observedRows.push(structuredClone(passkeyTestState.rows))
        })

        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(observedEvents).toHaveLength(1)
        expect(observedEvents[0]?.at(-1)).toBe('transaction:commit')
        expect(observedEvents[0]).toContain('audit:tx')
        expect(observedEvents[0]?.indexOf('audit:tx')).toBeLessThan(
            observedEvents[0]?.indexOf('transaction:commit') ?? -1,
        )
        expect(observedRows[0]?.credentials).toEqual([
            { id: 'other-passkey', userId: 'other-user' },
        ])
        expect(observedRows[0]?.auditLogs).toEqual([
            expect.objectContaining({
                id: 'audit-1',
                createdAt: auditCreatedAt,
                action: 'user.passkey_deleted',
            }),
        ])
        expect(enqueueSecurityChange.mock.calls).toEqual([
            [
                {
                    to: recipient,
                    change: 'passkey_removed',
                    changedAt: auditCreatedAt.toISOString(),
                    auditEventId: 'audit-1',
                },
            ],
        ])
        expect(passkeyTestUser.email).toBe('kevin@example.test')
        expect(passkeyTestState.events.at(-1)).toBe('audit:publish')
    })

    it('does not notify again for a deletion that has already committed', async function () {
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: false,
            error: 'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.',
        })
        expect(passkeyTestState.rows.auditLogs).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('prevents an already verified proof from deleting another owned passkey after the session was revoked', async function () {
        const secondPasskey = {
            id: '22222222-2222-4222-8222-222222222222',
            userId: passkeyTestUser.id,
        }
        passkeyTestState.rows.credentials.push(secondPasskey)
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(
            await deleteCurrentUserPasskeyService({
                ...input,
                passkeyId: secondPasskey.id,
            }),
        ).toMatchObject({ success: false })
        expect(passkeyTestState.rows.credentials).toContainEqual(secondPasskey)
        expect(passkeyTestState.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(passkeyTestState.rows.auditLogs).toHaveLength(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
    })

    it('rolls back the factor mutation and every session when session deletion fails', async function () {
        const before = structuredClone(passkeyTestState.rows)
        passkeyTestState.failDeleteTable = 'sessions'
        await expect(deleteCurrentUserPasskeyService(input)).rejects.toThrow(
            'Synthetic Passkey delete failure',
        )
        expect(passkeyTestState.rows).toEqual(before)
        expect(passkeyTestState.events.at(-1)).toBe('transaction:rollback')
        expect(audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })

    it('attempts revocation after committed mail even if later audit publication fails', async function () {
        enqueueSecurityChange.mockImplementationOnce(async function () {
            expect(passkeyTestState.rows.sessions).toEqual([
                passkeyTestOtherUserSession,
            ])
            expect(passkeyTestState.events.at(-1)).toBe('transaction:commit')
            passkeyTestState.events.push('notification')
        })
        publishAudit.mockImplementationOnce(async function () {
            passkeyTestState.events.push('audit:publish')
            throw new Error('Synthetic audit publication failure')
        })
        await expect(deleteCurrentUserPasskeyService(input)).rejects.toThrow(
            'Synthetic audit publication failure',
        )
        expect(passkeyTestState.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(passkeyTestState.rows.auditLogs).toHaveLength(1)
        expect(passkeyTestState.events.slice(-4)).toEqual([
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
        expect(passkeyTestState.events).not.toContain('transaction:rollback')
    })

    it('keeps the committed factor change and audit publication when revocation publishing fails', async function () {
        const failure = new Error('Synthetic realtime outage')
        publishSessionRevocation.mockRejectedValueOnce(failure)
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(passkeyTestState.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(passkeyTestState.rows.auditLogs).toHaveLength(1)
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
        expect(passkeyTestState.events).not.toContain('transaction:rollback')
    })
    it('keeps the committed deletion and public success if notification queueing fails', async function () {
        enqueueSecurityChange.mockRejectedValueOnce(
            new Error('synthetic queue outage'),
        )
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(passkeyTestState.rows.credentials).toEqual([
            { id: 'other-passkey', userId: 'other-user' },
        ])
        expect(passkeyTestState.rows.auditLogs).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
        expect(passkeyTestState.rows.sessions).toEqual([
            passkeyTestOtherUserSession,
        ])
        expect(passkeyTestState.events).toContain('transaction:commit')
        expect(passkeyTestState.events).not.toContain('transaction:rollback')
        expect(passkeyTestState.events.at(-1)).toBe('audit:publish')
    })
})

async function createTotpDeletionInput() {
    const user = { ...passkeyTestUser, isTwoFactorEnabled: true }
    passkeyTestState.rows.users[0] = user
    passkeyTestState.rows.factors = [
        { id: 'factor-1', userId: user.id, verified: true },
    ]
    const currentProof = await createReauthenticationProofService(
        user,
        'factor-1',
        PASSKEY_TEST_SESSION_HASH,
    )
    reauthenticate.mockResolvedValue({
        success: true,
        currentUser: user,
        proof: currentProof,
    })
    return {
        ...input,
        reauthentication: { method: 'totp' as const, credential: '123456' },
    }
}

describe('Passkey deletion remaining-login policy', () => {
    it('blocks last-method deletion after locked TOTP confirmation without mutation or notifications', async () => {
        const data = await createTotpDeletionInput()
        const before = structuredClone(passkeyTestState.rows)
        const result = await deleteCurrentUserPasskeyService(data)
        expect(result.success).toBe(false)
        expect(passkeyTestState.rows).toEqual(before)
        expect(passkeyTestState.events).toContain('lock:users')
        expect(passkeyTestState.events).toContain('lock:sessions')
        expect(passkeyTestState.events).toContain('lock:factors')
        expect(remainingSignIn).toHaveBeenCalledWith(expect.anything(), {
            userId: passkeyTestUser.id,
            excludedPasskeyId: input.passkeyId,
        })
        expect(audit).not.toHaveBeenCalled()
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(publishSessionRevocation).not.toHaveBeenCalled()
    })
    it('allows TOTP removal when the shared policy confirms another usable sign-in method', async () => {
        const data = await createTotpDeletionInput()
        remainingSignIn.mockResolvedValueOnce(true)
        expect(await deleteCurrentUserPasskeyService(data)).toEqual({
            success: true,
        })
        expect(
            passkeyTestState.rows.credentials.some(
                (row) => row.id === input.passkeyId,
            ),
        ).toBe(false)
        expect(audit).toHaveBeenCalledTimes(1)
        expect(publishSessionRevocation).toHaveBeenCalledTimes(1)
    })
    it('allows confirmed-password removal without mistaking stored placeholder hashes for proof', async () => {
        expect(await deleteCurrentUserPasskeyService(input)).toEqual({
            success: true,
        })
        expect(remainingSignIn).not.toHaveBeenCalled()
    })
    it('never checks remaining methods or removes credentials when the proof became stale', async () => {
        const data = await createTotpDeletionInput()
        passkeyTestState.beforeUserLock = () => {
            passkeyTestState.rows.sessions = []
        }
        expect(await deleteCurrentUserPasskeyService(data)).toMatchObject({
            success: false,
        })
        expect(remainingSignIn).not.toHaveBeenCalled()
        expect(passkeyTestState.rows.credentials).toHaveLength(2)
    })
})
