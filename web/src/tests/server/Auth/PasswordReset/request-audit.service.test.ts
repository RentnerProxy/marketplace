import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { AuthMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import { requestPasswordResetService } from '@/server/Auth/ForgotPassword/request.service.ts'
import { requestCurrentUserPasswordResetService } from '@/server/UserSettings/Security/password-reset.service.ts'
import { cleanupPasswordResetTokenService } from '@/server/Auth/PasswordReset/cleanup.service.ts'
import {
    authAuditDb,
    authAuditMocks,
    authAuditOrm,
    authAuditSchema,
    authAuditState,
    resetAuthAuditTestState,
} from '../audit-transaction.test.helpers.ts'

const user = {
    id: 'user-1',
    username: 'known-user',
    email: 'user@example.test',
    isActive: true,
    isDeleted: false,
}
const queue = vi.fn(async function (_input: AuthMailInput) {
    authAuditState.events.push('queue')
})
const logger = { logError: vi.fn() }
const currentUser = vi.fn(async function () {
    return user
})
vi.mock('drizzle-orm', () => authAuditOrm)
vi.mock('@/db', () => ({ db: authAuditDb }))
vi.mock('@/db/schema.ts', () => authAuditSchema)
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => authAuditMocks)
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentUserSettingsSession: currentUser,
}))
vi.mock('@/server/Auth/PasswordReset/token.service.ts', () => ({
    createPasswordResetTokenService: async () => ({
        token: 'synthetic-raw-reset-token',
        tokenHash: 'synthetic-reset-hash',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
    }),
}))
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueuePasswordResetMail: queue,
}))
vi.mock('@/server/Logging/logger.ts', () => logger)

const flows = [
    {
        name: 'public',
        action: 'auth.password_reset_requested',
        actor: null,
        invoke: () => requestPasswordResetService({ email: user.email }),
    },
    {
        name: 'private',
        action: 'user.password_reset_requested',
        actor: user.id,
        invoke: () => requestCurrentUserPasswordResetService(),
    },
]
function targetTokens() {
    return authAuditState.rows.passwordResetTokens.filter(
        (row) => row.userId === user.id,
    )
}
beforeEach(function () {
    vi.clearAllMocks()
    resetAuthAuditTestState()
    authAuditState.rows.users = [{ ...user }]
    authAuditState.rows.passwordResetTokens = [
        { id: 'old-token', userId: user.id, tokenHash: 'old-hash' },
        { id: 'other-token', userId: 'other-user', tokenHash: 'other-hash' },
    ]
})

describe('reset request and compensation audit transactions', function () {
    it.each(flows)(
        'commits $name token and audit before queueing without leaking receipts or tokens',
        async function (flow) {
            expect(await flow.invoke()).toEqual({ success: true })
            expect(targetTokens()).toEqual([
                expect.objectContaining({
                    tokenHash: 'synthetic-reset-hash',
                    expiresAt: new Date('2030-01-01T00:00:00Z'),
                }),
            ])
            expect(queue).toHaveBeenCalledTimes(1)
            const mail = queue.mock.calls[0]?.[0]
            if (!mail) throw new Error('Expected a queued reset mail')
            const resetUrl = new URL(mail.resetLink)
            expect(mail).toEqual({
                to: user.email,
                username: user.username,
                resetLink:
                    resetUrl.origin +
                    '/password-reset#token=synthetic-raw-reset-token',
            })
            expect(resetUrl.pathname).toBe('/password-reset')
            expect(resetUrl.search).toBe('')
            expect(resetUrl.hash).toBe('#token=synthetic-raw-reset-token')
            expect(authAuditState.rows.passwordResetTokens).toContainEqual({
                id: 'other-token',
                userId: 'other-user',
                tokenHash: 'other-hash',
            })
            expect(authAuditState.rows.auditLogs).toEqual([
                expect.objectContaining({
                    actorUserId: flow.actor,
                    action: flow.action,
                }),
            ])
            const events = authAuditState.events
            expect(events.indexOf('context')).toBeLessThan(
                events.indexOf('tx:begin'),
            )
            expect(events.indexOf('lock:users')).toBeLessThan(
                events.indexOf('delete:passwordResetTokens'),
            )
            expect(events.indexOf('audit:tx')).toBeLessThan(
                events.indexOf('tx:commit'),
            )
            expect(events.indexOf('tx:commit')).toBeLessThan(
                events.indexOf('audit:publish'),
            )
            expect(events.indexOf('audit:publish')).toBeLessThan(
                events.indexOf('queue'),
            )
            expect(JSON.stringify(authAuditState.rows)).not.toContain(
                'synthetic-raw-reset-token',
            )
        },
    )
    it.each(flows)(
        'rolls back $name token replacement when its audit fails',
        async function (flow) {
            const before = structuredClone(authAuditState.rows)
            authAuditState.failAuditAt = 1
            await expect(flow.invoke()).rejects.toThrow(
                'Synthetic audit failure',
            )
            expect(authAuditState.rows).toEqual(before)
            expect(queue).not.toHaveBeenCalled()
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).not.toHaveBeenCalled()
        },
    )
    it.each(flows)(
        'cleans only its own $name token and audits compensation after queue failure',
        async function (flow) {
            queue.mockRejectedValueOnce(new Error('Synthetic queue failure'))
            expect(await flow.invoke()).toMatchObject({
                success: flow.name === 'public',
            })
            expect(targetTokens()).toEqual([])
            expect(authAuditState.rows.passwordResetTokens).toEqual([
                {
                    id: 'other-token',
                    userId: 'other-user',
                    tokenHash: 'other-hash',
                },
            ])
            expect(
                authAuditState.rows.auditLogs.map((row) => row.action),
            ).toEqual([flow.action, 'auth.password_reset_request_cancelled'])
            expect(
                authAuditState.events.filter((event) => event === 'lock:users'),
            ).toHaveLength(2)
            expect(authAuditState.rows.auditLogs[1].actorUserId).toBe(
                flow.actor,
            )
        },
    )
    it.each(flows)(
        'retains a replacement token during delayed $name queue-failure compensation',
        async function (flow) {
            queue.mockImplementationOnce(async function () {
                targetTokens()[0].tokenHash = 'newer-request-hash'
                throw new Error('Synthetic delayed queue failure')
            })
            await flow.invoke()
            expect(targetTokens()).toEqual([
                expect.objectContaining({ tokenHash: 'newer-request-hash' }),
            ])
            expect(authAuditState.rows.auditLogs).toHaveLength(2)
        },
    )
    it.each(flows)(
        'rolls back $name compensation on audit failure while retaining its first committed audit',
        async function (flow) {
            authAuditState.failAuditAt = 2
            queue.mockRejectedValueOnce(new Error('Synthetic queue failure'))
            if (flow.name === 'public')
                expect(await flow.invoke()).toEqual({ success: true })
            else
                await expect(flow.invoke()).rejects.toThrow(
                    'Synthetic audit failure',
                )
            expect(targetTokens()).toEqual([
                expect.objectContaining({ tokenHash: 'synthetic-reset-hash' }),
            ])
            expect(authAuditState.rows.auditLogs).toEqual([
                expect.objectContaining({ action: flow.action }),
            ])
            expect(authAuditState.events.at(-1)).toBe('tx:rollback')
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).toHaveBeenCalledTimes(1)
        },
    )
    it('does not create tokens, audits or mail for an unknown public account', async function () {
        expect(
            await requestPasswordResetService({
                email: 'missing@example.test',
            }),
        ).toEqual({ success: true })
        expect(authAuditDb.transaction).not.toHaveBeenCalled()
        expect(queue).not.toHaveBeenCalled()
        expect(authAuditState.rows.auditLogs).toEqual([])
    })
    it('records compensation anonymously if the requesting account was deleted in between', async function () {
        authAuditState.rows.users = []
        authAuditState.rows.passwordResetTokens = []
        await cleanupPasswordResetTokenService(
            user.id,
            'synthetic-reset-hash',
            { actorUserId: user.id, route: null, method: 'POST' },
        )
        expect(authAuditState.rows.auditLogs).toEqual([
            expect.objectContaining({
                actorUserId: null,
                action: 'auth.password_reset_request_cancelled',
            }),
        ])
    })
})
