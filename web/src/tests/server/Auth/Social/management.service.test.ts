import { beforeEach, describe, expect, it, mock } from 'bun:test'

const proof = {
    userId: 'current-user',
    sessionHash: 'current-session',
    credentialVersion: 'version',
}
const confirmation = mock(async () => ({
    success: true,
    currentUser: { id: 'current-user' },
    proof,
    error: 'Bad confirmation',
}))
const validate = mock(
    async (): Promise<{
        currentUser: { id: string }
        sessionHash: string
    } | null> => ({
        currentUser: { id: 'current-user' },
        sessionHash: 'current-session',
    }),
)
const audit = mock(async () => ({
    id: 'audit',
    createdAt: new Date('2026-01-01'),
}))
const publish = mock(async () => {})
const revoke = mock(async (_input: unknown) => {})
const failures = mock()
let linked = [{ id: 'linked', provider: 'github' }]
let passkeys: Array<{ id: string }> = []
const deleteWhere = mock((_condition: unknown) => ({
    returning: async () => [{ id: 'removed' }],
}))
const remove = mock((_table: unknown) => ({ where: deleteWhere }))
const txSelect = mock((_selection: unknown) => ({
    from: (table: unknown) => ({
        where: (_condition: unknown) =>
            Promise.resolve(table === 'passkeys' ? passkeys : linked),
    }),
}))
const transaction = mock(
    async (
        work: (tx: {
            select: typeof txSelect
            delete: typeof remove
        }) => Promise<unknown>,
    ) => work({ select: txSelect, delete: remove }),
)
mock.module('@/db/schema.ts', () => ({
    passkeyCredentials: 'passkeys',
    sessions: { id: 'session-id', userId: 'session-user' },
}))
mock.module('@/server/Auth/reauthentication.service.ts', () => ({
    reauthenticateCurrentUserService: confirmation,
}))
mock.module('@/server/Auth/reauthentication-proof.service.ts', () => ({
    validateReauthenticationProofService: validate,
}))
mock.module('@/lib/AuditLogs/auditLogs.ts', () => ({
    prepareAuditContextService: (userId: string) => ({ actorUserId: userId }),
    writeAuditLogInTransactionService: audit,
    publishCommittedAuditLogService: publish,
}))
mock.module('@/server/Realtime/publish.service.ts', () => ({
    publishSessionRevokedService: revoke,
}))
mock.module('@/server/Logging/logger.ts', () => ({ logError: failures }))

const currentUser = mock(async (): Promise<{ id: string } | null> => ({
    id: 'current-user',
}))
const configured = mock(() => [{ id: 'google' as const, name: 'Google' }])
const rows = [
    { id: 'linked', provider: 'github', createdAt: new Date('2026-01-01') },
    { id: 'unknown', provider: 'unknown', createdAt: new Date('2026-01-02') },
]
const where = mock(() => ({ orderBy: async () => rows }))
const select = mock((_selection: unknown) => ({ from: () => ({ where }) }))
mock.module('@/db', () => ({ db: { select, transaction } }))
mock.module('@/db/Schema/socialAuth.ts', () => ({
    socialAccounts: {
        id: 'id',
        userId: 'userId',
        provider: 'provider',
        createdAt: 'createdAt',
    },
}))
mock.module('drizzle-orm', () => ({
    eq: (...values: unknown[]) => values,
    ne: (...values: unknown[]) => ['ne', ...values],
    and: (...values: unknown[]) => values,
    desc: (value: unknown) => value,
}))
mock.module('@/server/Auth/currentSession.ts', () => ({
    getActiveCurrentSessionUser: currentUser,
}))
mock.module('@/server/Auth/Social/config.service.ts', () => ({
    getConfiguredSocialProvidersService: configured,
}))

const {
    getCurrentUserSocialAccountsService,
    unlinkCurrentUserSocialAccountService,
} = await import('@/server/Auth/Social/management.service.ts')

beforeEach(() => {
    select.mockClear()
    confirmation.mockClear()
    confirmation.mockResolvedValue({
        success: true,
        currentUser: { id: 'current-user' },
        proof,
        error: 'Bad confirmation',
    })
    validate.mockClear()
    validate.mockResolvedValue({
        currentUser: { id: 'current-user' },
        sessionHash: 'current-session',
    })
    audit.mockClear()
    publish.mockClear()
    revoke.mockClear()
    failures.mockClear()
    transaction.mockClear()
    remove.mockClear()
    linked = [{ id: 'linked', provider: 'github' }]
    passkeys = []
    currentUser.mockResolvedValue({ id: 'current-user' })
})

describe('Current user social accounts', () => {
    it('scopes account metadata to the authenticated user without exposing provider subjects', async () => {
        const result = await getCurrentUserSocialAccountsService()
        expect(where).toHaveBeenCalledWith(['userId', 'current-user'])
        expect(result).toEqual({
            providers: [{ id: 'google', name: 'Google' }],
            accounts: [
                {
                    id: 'linked',
                    provider: 'github',
                    createdAt: new Date('2026-01-01'),
                },
            ],
        })
        expect(select.mock.calls[0]?.[0]).toEqual({
            id: 'id',
            provider: 'provider',
            createdAt: 'createdAt',
        })
    })

    it('rejects expired or missing sessions without querying accounts', async () => {
        currentUser.mockResolvedValueOnce(null)
        await expect(getCurrentUserSocialAccountsService()).rejects.toThrow(
            'Du musst angemeldet sein.',
        )
        expect(select).not.toHaveBeenCalled()
    })
})

const passwordInput = {
    provider: 'github' as const,
    reauthentication: {
        method: 'password' as const,
        credential: 'known-password',
    },
}
const totpInput = {
    provider: 'github' as const,
    reauthentication: { method: 'totp' as const, credential: '123456' },
}
describe('Social account unlink safeguards', () => {
    it('requires fresh confirmation before beginning a transaction', async () => {
        confirmation.mockResolvedValueOnce({
            success: false,
            currentUser: { id: 'current-user' },
            proof,
            error: 'Bad confirmation',
        })
        expect(
            await unlinkCurrentUserSocialAccountService(passwordInput),
        ).toMatchObject({ success: false })
        expect(transaction).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
    })
    it('revalidates proof under the existing user/session locks before removal', async () => {
        validate.mockResolvedValueOnce(null)
        expect(
            await unlinkCurrentUserSocialAccountService(passwordInput),
        ).toEqual({ success: false, error: 'auth.social.confirmation_failed' })
        expect(validate).toHaveBeenCalledWith(expect.anything(), proof)
        expect(remove).not.toHaveBeenCalled()
    })
    it('allows a proven usable password and preserves the confirmed session', async () => {
        expect(
            await unlinkCurrentUserSocialAccountService(passwordInput),
        ).toEqual({ success: true })
        expect(deleteWhere).toHaveBeenLastCalledWith([
            ['session-user', 'current-user'],
            ['ne', 'session-id', 'current-session'],
        ])
        expect(audit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: 'auth.social_account_unlinked',
                newValues: { provider: 'github', sessionsRevoked: 'other' },
            }),
        )
        expect(publish).toHaveBeenCalledTimes(1)
        expect(revoke).toHaveBeenCalledWith({
            userId: 'current-user',
            sessionHash: 'removed',
            revokedAt: '2026-01-01T00:00:00.000Z',
        })
    })
    it('does not mistake a placeholder hash or disabled provider for a remaining login method', async () => {
        linked.push({ id: 'disabled', provider: 'discord' })
        expect(await unlinkCurrentUserSocialAccountService(totpInput)).toEqual({
            success: false,
            error: 'auth.social.last_method',
        })
        expect(remove).not.toHaveBeenCalled()
        expect(audit).not.toHaveBeenCalled()
    })
    it('allows TOTP confirmation when a configured linked provider remains', async () => {
        linked.push({ id: 'other', provider: 'google' })
        expect(await unlinkCurrentUserSocialAccountService(totpInput)).toEqual({
            success: true,
        })
    })
    it('allows TOTP confirmation when a real passkey remains', async () => {
        passkeys = [{ id: 'passkey' }]
        expect(await unlinkCurrentUserSocialAccountService(totpInput)).toEqual({
            success: true,
        })
    })
    it('rejects missing links and reports no success audit', async () => {
        linked = []
        expect(
            await unlinkCurrentUserSocialAccountService(passwordInput),
        ).toEqual({ success: false, error: 'auth.social.not_linked' })
        expect(remove).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })
    it('does not publish success or revocations when the mutation transaction fails', async () => {
        transaction.mockRejectedValueOnce(new Error('Audit failed'))
        await expect(
            unlinkCurrentUserSocialAccountService(passwordInput),
        ).rejects.toThrow('Audit failed')
        expect(publish).not.toHaveBeenCalled()
        expect(revoke).not.toHaveBeenCalled()
    })
})

it('keeps a committed unlink successful when realtime publication fails', async () => {
    revoke.mockRejectedValueOnce(new Error('Realtime unavailable'))
    expect(await unlinkCurrentUserSocialAccountService(passwordInput)).toEqual({
        success: true,
    })
    expect(failures).toHaveBeenCalledWith(
        'auth.social.unlink_realtime_revoke_failed',
        expect.any(Error),
        { auditLogId: 'audit' },
    )
})

it('excludes the passkey being deleted and ignores disabled providers in the shared remaining-method policy', async () => {
    const { hasRemainingSignInMethodService } =
        await import('@/server/Auth/remaining-sign-in.service.ts')
    const { db } = await import('@/db')
    linked = [{ id: 'disabled', provider: 'discord' }]
    passkeys = [{ id: 'target' }]
    expect(
        await db.transaction((tx) =>
            hasRemainingSignInMethodService(tx, {
                userId: 'current-user',
                excludedPasskeyId: 'target',
            }),
        ),
    ).toBe(false)
    passkeys.push({ id: 'remaining' })
    expect(
        await db.transaction((tx) =>
            hasRemainingSignInMethodService(tx, {
                userId: 'current-user',
                excludedPasskeyId: 'target',
            }),
        ),
    ).toBe(true)
    passkeys = [{ id: 'target' }]
    linked = [{ id: 'remaining', provider: 'google' }]
    expect(
        await db.transaction((tx) =>
            hasRemainingSignInMethodService(tx, {
                userId: 'current-user',
                excludedPasskeyId: 'target',
            }),
        ),
    ).toBe(true)
})
