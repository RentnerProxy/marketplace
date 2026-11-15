import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { REAUTHENTICATION_PROOF_DURATION_MS } from '@/config/security.config.ts'
import {
    createReauthenticationProofService,
    getLockedReauthenticationStateService,
    validateReauthenticationProofService,
} from '@/server/Auth/reauthentication-proof.service.ts'
import type {
    ReauthenticationProof,
    ReauthenticationTransaction,
} from '@/server/Auth/Types/reauthentication.types.ts'

import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

const NOW = 1_800_000_000_000
const SESSION_HASH = 'a'.repeat(64)
function createUser(enabled = false) {
    return {
        id: 'user-1',
        username: 'kevin',
        email: 'kevin@example.test',
        passwordHash: 'verified-password-hash',
        isTwoFactorEnabled: enabled,
        isActive: true,
        isDeleted: false,
    }
}
function createSession() {
    return {
        id: SESSION_HASH,
        userId: 'user-1',
        expiresAt: new Date(NOW + 300_000),
    }
}
function createFactor() {
    return {
        id: 'factor-1',
        userId: 'user-1',
        verified: true,
        secret: 'rotating-ciphertext',
    }
}
const tables = {
    users: {
        id: 'users.id',
        username: 'users.username',
        email: 'users.email',
        passwordHash: 'users.passwordHash',
        isTwoFactorEnabled: 'users.isTwoFactorEnabled',
        isActive: 'users.isActive',
        isDeleted: 'users.isDeleted',
    },
    sessions: {
        id: 'sessions.id',
        userId: 'sessions.userId',
        expiresAt: 'sessions.expiresAt',
    },
    twoFactorAuth: {
        id: 'factor.id',
        userId: 'factor.userId',
        verified: 'factor.verified',
    },
}
const state = {
    user: createUser() as ReturnType<typeof createUser> | null,
    session: createSession() as ReturnType<typeof createSession> | null,
    factor: null as ReturnType<typeof createFactor> | null,
    events: [] as Array<string>,
    conditions: [] as Array<unknown>,
    userWait: vi.fn(async function () {}),
    sessionWait: vi.fn(async function () {}),
    factorWait: vi.fn(async function () {}),
}
const transactionMock = {
    select: vi.fn(function () {
        let table: unknown
        const chain = {
            from(value: unknown) {
                table = value
                return chain
            },
            where(condition: unknown) {
                state.conditions.push(condition)
                return chain
            },
            limit() {
                return chain
            },
            async for(mode: string) {
                if (mode !== 'update')
                    throw new Error('Expected exclusive row lock')
                if (table === tables.users) {
                    state.events.push('user')
                    await state.userWait()
                    return state.user?.isActive && !state.user.isDeleted
                        ? [state.user]
                        : []
                }
                if (table === tables.sessions) {
                    state.events.push('session')
                    await state.sessionWait()
                    return state.session ? [state.session] : []
                }
                state.events.push('factor')
                await state.factorWait()
                return state.factor ? [state.factor] : []
            },
        }
        return chain
    }),
}
const transaction = transactionMock as unknown as ReauthenticationTransaction
vi.mock('@/db/schema.ts', () => tables)
vi.mock('drizzle-orm', () => ({
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    and: (...conditions: Array<unknown>) => ({ and: conditions }),
}))
let clock: ReturnType<typeof vi.spyOn>
beforeEach(function () {
    vi.clearAllMocks()
    clock = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    state.user = createUser()
    state.session = createSession()
    state.factor = null
    state.events = []
    state.conditions = []
    state.userWait.mockReset().mockResolvedValue(undefined)
    state.sessionWait.mockReset().mockResolvedValue(undefined)
    state.factorWait.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

async function proof(enabled = false) {
    return createReauthenticationProofService(
        createUser(enabled),
        enabled ? 'factor-1' : null,
        SESSION_HASH,
    )
}

describe('Reauthentication credential proof', function () {
    it('contains only its identity, two hashes and a short deadline', async function () {
        const result = await proof()
        expect(Object.keys(result).toSorted()).toEqual([
            'credentialVersion',
            'expiresAt',
            'sessionHash',
            'userId',
        ])
        expect(result.credentialVersion).toMatch(/^[a-f0-9]{64}$/)
        expect(result.expiresAt).toBe(NOW + REAUTHENTICATION_PROOF_DURATION_MS)
        expect(JSON.stringify(result)).not.toContain('verified-password-hash')
    })
    it('binds password version, user, MFA flag and stable factor enrollment', async function () {
        const original = await proof(true)
        const changes = [
            [
                {
                    ...createUser(true),
                    passwordHash: 'replacement-password-hash',
                },
                'factor-1',
            ],
            [{ ...createUser(true), id: 'user-2' }, 'factor-1'],
            [createUser(false), null],
            [createUser(true), 'factor-2'],
        ] as const
        await Promise.all(
            changes.map(async function ([user, factorId]) {
                const changed = await createReauthenticationProofService(
                    user,
                    factorId,
                    SESSION_HASH,
                )
                expect(changed.credentialVersion).not.toBe(
                    original.credentialVersion,
                )
            }),
        )
    })
    it('locks User before Session and Factor and matches ownership in SQL', async function () {
        const result = await validateReauthenticationProofService(
            transaction,
            await proof(),
        )
        expect(result?.currentUser.id).toBe('user-1')
        expect(state.events).toEqual(['user', 'session', 'factor'])
        expect(state.conditions[0]).toEqual({
            and: [
                { eq: ['users.id', 'user-1'] },
                { eq: ['users.isActive', true] },
                { eq: ['users.isDeleted', false] },
            ],
        })
        expect(state.conditions[1]).toEqual({
            and: [
                { eq: ['sessions.id', SESSION_HASH] },
                { eq: ['sessions.userId', 'user-1'] },
            ],
        })
    })
    it.each(['password', 'factor', 'flag'] as const)(
        'rejects a changed %s snapshot',
        async function (change) {
            const verified = await proof(true)
            state.user = createUser(true)
            state.factor = createFactor()
            if (change === 'password') state.user.passwordHash = 'new-password'
            if (change === 'factor') state.factor.id = 'replacement-factor'
            if (change === 'flag') {
                state.user.isTwoFactorEnabled = false
                state.factor = null
            }
            expect(
                await validateReauthenticationProofService(
                    transaction,
                    verified,
                ),
            ).toBeNull()
        },
    )
    it('accepts replay-counter/ciphertext rotation of the same verified factor ID', async function () {
        const verified = await proof(true)
        state.user = createUser(true)
        state.factor = createFactor()
        state.factor.secret = 'new-ciphertext-after-consumption'
        expect(
            await validateReauthenticationProofService(transaction, verified),
        ).toMatchObject({
            factorId: 'factor-1',
            credentialVersion: verified.credentialVersion,
        })
    })
    it.each(['missing', 'unverified', 'unexpected'] as const)(
        'rejects %s verified-factor state',
        async function (kind) {
            state.user = createUser(kind !== 'unexpected')
            state.factor =
                kind === 'missing'
                    ? null
                    : { ...createFactor(), verified: kind === 'unexpected' }
            expect(
                await getLockedReauthenticationStateService(transaction, {
                    userId: 'user-1',
                    sessionHash: SESSION_HASH,
                }),
            ).toBeNull()
        },
    )
    it.each(['inactive', 'deleted', 'missing'] as const)(
        'stops before child locks for %s users',
        async function (kind) {
            if (kind === 'missing') state.user = null
            else if (state.user) {
                state.user.isActive = kind !== 'inactive'
                state.user.isDeleted = kind === 'deleted'
            }
            expect(
                await validateReauthenticationProofService(
                    transaction,
                    await proof(),
                ),
            ).toBeNull()
            expect(state.events).toEqual(['user'])
        },
    )
    it.each(['revoked', 'expired'] as const)(
        'rejects a %s current session',
        async function (kind) {
            state.session =
                kind === 'revoked'
                    ? null
                    : { ...createSession(), expiresAt: new Date(NOW) }
            expect(
                await validateReauthenticationProofService(
                    transaction,
                    await proof(),
                ),
            ).toBeNull()
            expect(state.events).toEqual(['user', 'session'])
        },
    )
    it('observes a session revoked while waiting for the user lock', async function () {
        state.userWait.mockImplementationOnce(async () => {
            state.session = null
        })
        expect(
            await validateReauthenticationProofService(
                transaction,
                await proof(),
            ),
        ).toBeNull()
        expect(state.events).toEqual(['user', 'session'])
    })
    it.each(['session', 'factor'] as const)(
        'rechecks session expiry after the %s lock wait',
        async function (lock) {
            state.session = {
                ...createSession(),
                expiresAt: new Date(NOW + 1000),
            }
            state[
                lock === 'session' ? 'sessionWait' : 'factorWait'
            ].mockImplementationOnce(async () => {
                clock.mockReturnValue(NOW + 1000)
            })
            expect(
                await getLockedReauthenticationStateService(transaction, {
                    userId: 'user-1',
                    sessionHash: SESSION_HASH,
                }),
            ).toBeNull()
        },
    )
    it('rechecks proof deadline after the final factor lock', async function () {
        const verified = await proof()
        state.factorWait.mockImplementationOnce(async () => {
            clock.mockReturnValue(verified.expiresAt)
        })
        expect(
            await validateReauthenticationProofService(transaction, verified),
        ).toBeNull()
    })
    it('invalidates password changes made during the user-lock wait', async function () {
        const verified = await proof()
        state.userWait.mockImplementationOnce(async () => {
            state.user = { ...createUser(), passwordHash: 'changed-under-lock' }
        })
        expect(
            await validateReauthenticationProofService(transaction, verified),
        ).toBeNull()
    })
    it('rejects expired, overlong, malformed and extra-field proofs before locking', async function () {
        const verified = await proof()
        const invalidProofs = [
            { ...verified, expiresAt: NOW },
            { ...verified, expiresAt: Infinity },
            {
                ...verified,
                expiresAt: NOW + REAUTHENTICATION_PROOF_DURATION_MS + 1,
            },
            {
                ...verified,
                credentialVersion: verified.credentialVersion + '\n',
            },
            { ...verified, sessionHash: SESSION_HASH + '\n' },
            { ...verified, extra: 'untrusted' },
        ]
        await Promise.all(
            invalidProofs.map(async function (invalid) {
                expect(
                    await validateReauthenticationProofService(
                        transaction,
                        invalid as ReauthenticationProof,
                    ),
                ).toBeNull()
            }),
        )
        expect(transactionMock.select).not.toHaveBeenCalled()
    })
    it('rejects mismatched proof factor kinds before issuing a proof', async function () {
        await expect(
            createReauthenticationProofService(
                createUser(true),
                null,
                SESSION_HASH,
            ),
        ).rejects.toThrow()
        await expect(
            createReauthenticationProofService(
                createUser(false),
                'factor-1',
                SESSION_HASH,
            ),
        ).rejects.toThrow()
    })
    it('records expired immediate proof once before acquiring any lock', async function () {
        const expired = { ...(await proof()), expiresAt: NOW }
        expect(
            await validateReauthenticationProofService(transaction, expired),
        ).toBeNull()
        expect(state.events).toEqual([])
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'stale_proof'],
        ])
    })

    it('records changed credentials once after the shared state validator rejects', async function () {
        const verified = await proof()
        state.user = {
            ...createUser(),
            passwordHash: 'replacement-secret-hash',
        }
        expect(
            await validateReauthenticationProofService(transaction, verified),
        ).toBeNull()
        expect(mockedRejection.mock.calls).toEqual([
            ['reauthentication', 'stale_proof'],
        ])
        expect(JSON.stringify(mockedRejection.mock.calls)).not.toContain(
            'replacement-secret-hash',
        )
    })

    it('leaves direct state checks silent so outer ceremony guards own their denial', async function () {
        state.session = null
        expect(
            await getLockedReauthenticationStateService(transaction, {
                userId: 'user-1',
                sessionHash: SESSION_HASH,
            }),
        ).toBeNull()
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('preserves lock failures and successful proof validation without rejection events', async function () {
        const verified = await proof()
        expect(
            await validateReauthenticationProofService(transaction, verified),
        ).not.toBeNull()
        expect(mockedRejection).not.toHaveBeenCalled()
        const storage = new Error('synthetic lock failure')
        state.userWait.mockRejectedValueOnce(storage)
        await expect(
            validateReauthenticationProofService(transaction, verified),
        ).rejects.toBe(storage)
        expect(mockedRejection).not.toHaveBeenCalled()
    })
})
