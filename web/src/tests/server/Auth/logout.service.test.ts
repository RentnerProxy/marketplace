import { Buffer } from 'node:buffer'
import { sessionConfig } from '@/config/session.config.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { logoutService } from '@/server/Auth/logout.service.ts'
import {
    authAuditDb,
    authAuditMocks,
    authAuditOrm,
    authAuditSchema,
    authAuditState,
    resetAuthAuditTestState,
} from './audit-transaction.test.helpers.ts'

function createTestSessionToken(issuedAt = Date.now()) {
    return 's1.' + issuedAt + '.' + Buffer.alloc(32, 7).toString('base64url')
}

const cookies = { token: createTestSessionToken(), failDelete: false }
const hashToken = vi.fn(async (token: string) => 'hash:' + token)
const publish = vi.fn(async function () {
    authAuditState.events.push('session:publish')
})
const deleteCookie = vi.fn(function () {
    authAuditState.events.push('cookie:delete')
    if (cookies.failDelete) throw new Error('Synthetic cookie failure')
})
const logError = vi.fn()
vi.mock('drizzle-orm', () => authAuditOrm)
vi.mock('@/db', () => ({ db: authAuditDb }))
vi.mock('@/db/schema.ts', () => authAuditSchema)
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => authAuditMocks)
vi.mock('@/lib/Auth/tokens.ts', () => ({
    createTokenHash: hashToken,
}))
vi.mock('@tanstack/react-start/server', () => ({
    getCookie: () => cookies.token || undefined,
    deleteCookie,
}))
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishSessionRevokedService: publish,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError }))

beforeEach(function () {
    vi.clearAllMocks()
    resetAuthAuditTestState()
    cookies.token = createTestSessionToken()
    cookies.failDelete = false
    authAuditState.rows.users = [{ id: 'user-1' }]
    authAuditState.rows.sessions = [
        { id: 'hash:' + cookies.token, userId: 'user-1' },
        { id: 'hash:unrelated', userId: 'other-user' },
    ]
})

describe('atomic logout audit', function () {
    it('resolves its actor, locks User before Session and commits audit before cookie and realtime', async function () {
        expect(await logoutService()).toEqual({ success: true })
        expect(authAuditState.rows.sessions).toEqual([
            { id: 'hash:unrelated', userId: 'other-user' },
        ])
        expect(authAuditState.rows.auditLogs).toEqual([
            expect.objectContaining({
                actorUserId: 'user-1',
                action: 'auth.logout',
            }),
        ])
        expect(authAuditState.events).toEqual([
            'read:sessions',
            'context',
            'tx:begin',
            'lock:users',
            'read:users',
            'delete:sessions',
            'audit:tx',
            'tx:commit',
            'audit:publish',
            'session:publish',
            'cookie:delete',
        ])
        expect(JSON.stringify(authAuditState.rows.auditLogs)).not.toContain(
            cookies.token,
        )
    })
    it.each(['audit', 'commit'])(
        'restores the session and emits nothing when %s fails',
        async function (failure) {
            const before = structuredClone(authAuditState.rows)
            if (failure === 'audit') authAuditState.failAuditAt = 1
            else authAuditState.failCommitAt = 1
            await expect(logoutService()).rejects.toThrow(
                'Synthetic ' + failure + ' failure',
            )
            expect(authAuditState.rows).toEqual(before)
            expect(deleteCookie).not.toHaveBeenCalled()
            expect(publish).not.toHaveBeenCalled()
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).not.toHaveBeenCalled()
        },
    )
    it('retains committed logout audit when cookie deletion fails', async function () {
        cookies.failDelete = true
        await expect(logoutService()).rejects.toThrow(
            'Synthetic cookie failure',
        )
        expect(authAuditState.rows.auditLogs).toHaveLength(1)
        expect(authAuditState.rows.sessions).toHaveLength(1)
        expect(authAuditState.events).toContain('tx:commit')
    })
    it('retains logout success and audit after realtime failure', async function () {
        publish.mockRejectedValueOnce(new Error('Synthetic realtime failure'))
        expect(await logoutService()).toEqual({ success: true })
        expect(authAuditState.rows.auditLogs).toHaveLength(1)
        expect(deleteCookie).toHaveBeenCalledTimes(1)
        expect(logError).toHaveBeenCalledTimes(1)
    })
    it.each([
        'no cookie',
        'malformed',
        'legacy',
        'oversized',
        'expired',
        'future',
        'noncanonical entropy',
    ])('clears %s without database work or audit', async function (condition) {
        if (condition === 'no cookie') cookies.token = ''
        if (condition === 'malformed') cookies.token = 's1.invalid'
        if (condition === 'legacy') cookies.token = 'synthetic-session'
        if (condition === 'oversized') cookies.token = 'A'.repeat(4096)
        if (condition === 'expired')
            cookies.token = createTestSessionToken(
                Date.now() - sessionConfig.absoluteDurationMs,
            )
        if (condition === 'future')
            cookies.token = createTestSessionToken(Date.now() + 60_000)
        if (condition === 'noncanonical entropy')
            cookies.token = 's1.' + Date.now() + '.' + 'A'.repeat(42) + 'B'
        const before = structuredClone(authAuditState.rows)

        expect(await logoutService()).toEqual({ success: true })
        expect(authAuditState.rows).toEqual(before)
        expect(authAuditState.events).toEqual(['cookie:delete'])
        expect(authAuditDb.transaction).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
        expect(hashToken).not.toHaveBeenCalled()
    })

    it('clears an unknown current token after one read without writes or audit', async function () {
        cookies.token = createTestSessionToken(Date.now() - 60_000)
        const before = structuredClone(authAuditState.rows)
        expect(await logoutService()).toEqual({ success: true })
        expect(authAuditState.rows).toEqual(before)
        expect(authAuditState.events).toEqual([
            'read:sessions',
            'cookie:delete',
        ])
        expect(authAuditDb.transaction).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
        expect(hashToken).toHaveBeenCalledTimes(1)
    })

    it.each(['no cookie', 'unknown token'])(
        'does not amplify repeated %s requests into audit writes',
        async function (condition) {
            cookies.token =
                condition === 'no cookie'
                    ? ''
                    : createTestSessionToken(Date.now() - 60_000)
            const before = structuredClone(authAuditState.rows)
            const results = await Promise.all(
                Array.from({ length: 100 }, () => logoutService()),
            )
            expect(results.every((result) => result.success)).toBe(true)
            expect(authAuditState.rows).toEqual(before)
            expect(authAuditDb.transaction).not.toHaveBeenCalled()
            expect(
                authAuditMocks.writeAuditLogInTransactionService,
            ).not.toHaveBeenCalled()
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).not.toHaveBeenCalled()
            expect(publish).not.toHaveBeenCalled()
            expect(deleteCookie).toHaveBeenCalledTimes(100)
        },
    )

    it('audits and publishes a real revocation once across repeated cookie submissions', async function () {
        expect(await logoutService()).toEqual({ success: true })
        expect(await logoutService()).toEqual({ success: true })
        expect(authAuditState.rows.auditLogs).toHaveLength(1)
        expect(authAuditDb.transaction).toHaveBeenCalledTimes(1)
        expect(publish).toHaveBeenCalledTimes(1)
        expect(deleteCookie).toHaveBeenCalledTimes(2)
        expect(authAuditState.rows.sessions).toEqual([
            { id: 'hash:unrelated', userId: 'other-user' },
        ])
    })

    it.each(['missing actor', 'missing session', 'changed session owner'])(
        'avoids audit and revocation for %s after the outer read',
        async function (condition) {
            const executeTransaction =
                authAuditDb.transaction.getMockImplementation()
            if (!executeTransaction)
                throw new Error('Missing transaction fixture')
            authAuditDb.transaction.mockImplementationOnce(
                function (operation) {
                    if (condition === 'missing actor')
                        authAuditState.rows.users = []
                    if (condition === 'missing session')
                        authAuditState.rows.sessions =
                            authAuditState.rows.sessions.filter(
                                (session) => session.userId !== 'user-1',
                            )
                    if (condition === 'changed session owner')
                        authAuditState.rows.sessions[0].userId = 'other-user'
                    return executeTransaction(operation)
                },
            )

            expect(await logoutService()).toEqual({ success: true })
            expect(authAuditState.events.indexOf('read:sessions')).toBeLessThan(
                authAuditState.events.indexOf('lock:users'),
            )
            expect(authAuditState.events).toContain('tx:commit')
            expect(authAuditState.rows.auditLogs).toHaveLength(0)
            expect(
                authAuditMocks.writeAuditLogInTransactionService,
            ).not.toHaveBeenCalled()
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).not.toHaveBeenCalled()
            expect(publish).not.toHaveBeenCalled()
            expect(deleteCookie).toHaveBeenCalledTimes(1)
            if (condition === 'changed session owner')
                expect(authAuditState.rows.sessions[0]).toEqual({
                    id: 'hash:' + cookies.token,
                    userId: 'other-user',
                })
        },
    )
})
