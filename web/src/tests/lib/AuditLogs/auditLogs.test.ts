import { beforeEach, describe, expect, it } from 'bun:test'
import {
    AUDIT_TEST_ACTOR,
    createAuditTransactionTestModel,
} from './audit-transaction.test.helpers.ts'

const model = createAuditTransactionTestModel()
model.install()
const { db } = await import('@/db')
const {
    prepareAuditContextService,
    writeAuditLogInTransactionService,
    publishCommittedAuditLogService,
    writeStandaloneAuditLogService,
} = await import('@/lib/AuditLogs/auditLogs.ts')
const { lockAuditUsersInTransactionService } =
    await import('@/lib/AuditLogs/user-locks.ts')

function event() {
    return {
        ...prepareAuditContextService(AUDIT_TEST_ACTOR),
        action: 'test.changed',
    }
}

describe('mandatory audit transactions', function () {
    beforeEach(function () {
        model.reset()
        model.header.mockReturnValue(
            'https://example.test/settings?token=private#secret',
        )
    })

    it('prepares the verified actor and strips query and fragment without a session lookup', function () {
        expect(prepareAuditContextService(AUDIT_TEST_ACTOR)).toEqual({
            actorUserId: AUDIT_TEST_ACTOR,
            route: '/settings',
            method: 'POST',
        })
        expect(model.database.transaction).not.toHaveBeenCalled()
        expect(() =>
            Reflect.apply(prepareAuditContextService, null, [undefined]),
        ).toThrow('explicit audit actor')
    })

    it('supports explicit worker context outside HTTP and bounds request metadata', function () {
        model.header.mockImplementation(() => {
            throw new Error('No request')
        })
        expect(prepareAuditContextService(null)).toEqual({
            actorUserId: null,
            route: null,
            method: 'POST',
        })
        const context = prepareAuditContextService(null, {
            route: '/' + 'x'.repeat(300),
            method: 'W'.repeat(30),
        })
        expect(context.route).toHaveLength(255)
        expect(context.method).toHaveLength(20)
        expect(
            prepareAuditContextService(null, { route: null, method: 'WORKER' }),
        ).toEqual({
            actorUserId: null,
            route: null,
            method: 'WORKER',
        })
    })

    it('inserts only in the supplied transaction and publishes only after commit', async function () {
        const receipt = await db.transaction(async function (tx) {
            const saved = await writeAuditLogInTransactionService(tx, event())
            expect(model.publish).not.toHaveBeenCalled()
            expect(model.state.events).not.toContain('commit')
            return saved
        })
        expect(model.state.audits).toHaveLength(1)
        await publishCommittedAuditLogService(receipt)
        expect(model.state.events.at(-2)).toBe('commit')
        expect(model.state.events.at(-1)).toBe('publish-audit')
        expect(model.publish).toHaveBeenCalledWith({
            auditLogId: 'audit-1',
            createdAt: '2026-09-06T12:00:00.000Z',
        })
    })

    it('normalizes optional fields and caps text without retaining URL secrets', async function () {
        await db.transaction((tx) =>
            writeAuditLogInTransactionService(tx, {
                ...event(),
                action: 'a'.repeat(120),
                message: 'm'.repeat(600),
                route: '/settings?reset=secret#another-secret',
                method: 'M'.repeat(30),
            }),
        )
        const record = model.state.audits[0]
        expect(record?.action).toHaveLength(100)
        expect(record?.message).toHaveLength(500)
        expect(record?.method).toHaveLength(20)
        expect(record?.route).toBe('/settings')
        expect(record?.oldValues).toBeNull()
        expect(record?.newValues).toBeNull()
    })

    for (const failure of ['insert', 'commit']) {
        it(
            'rolls back the domain change and audit on ' + failure + ' failure',
            async function () {
                model.state.rows.set('domain', { value: 'before' })
                model.state.failAction =
                    failure === 'insert' ? 'test.changed' : null
                model.state.failCommit = failure === 'commit'
                await expect(
                    db.transaction(async function (tx) {
                        model.state.rows.set('domain', { value: 'after' })
                        return writeAuditLogInTransactionService(tx, event())
                    }),
                ).rejects.toThrow('synthetic')
                expect(model.state.rows.get('domain')).toEqual({
                    value: 'before',
                })
                expect(model.state.audits).toEqual([])
                expect(model.publish).not.toHaveBeenCalled()
            },
        )
    }

    for (const receipts of [
        [],
        [{ id: '', createdAt: new Date() }],
        [{ id: 'a', createdAt: new Date('invalid') }],
        [{ id: 'a', createdAt: '2026-09-06' }],
        [
            { id: 'a', createdAt: new Date() },
            { id: 'b', createdAt: new Date() },
        ],
    ]) {
        it('rejects a missing or malformed persisted receipt', async function () {
            model.state.auditReceipts = receipts
            await expect(
                db.transaction((tx) =>
                    writeAuditLogInTransactionService(tx, event()),
                ),
            ).rejects.toThrow('persisted receipt')
            expect(model.state.audits).toEqual([])
            expect(model.publish).not.toHaveBeenCalled()
        })
    }

    it('rejects an empty action before insertion', async function () {
        await expect(
            db.transaction((tx) =>
                writeAuditLogInTransactionService(tx, {
                    ...event(),
                    action: '  ',
                }),
            ),
        ).rejects.toThrow('actor and action')
        expect(model.state.events).not.toContain('insert:auditLogs')
    })

    it('keeps the committed audit when realtime is unavailable', async function () {
        model.state.failPublish = true
        await expect(
            writeStandaloneAuditLogService(event()),
        ).resolves.toBeUndefined()
        expect(model.state.audits).toHaveLength(1)
        expect(model.logger).toHaveBeenCalledWith(
            'audit.publish_failed',
            expect.any(Error),
            { auditLogId: 'audit-1' },
        )
        expect(model.state.events).not.toContain('rollback')
    })

    it('locks distinct actor and target users in canonical order before audit inserts', async function () {
        await db.transaction((tx) =>
            lockAuditUsersInTransactionService(tx, [
                'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
                AUDIT_TEST_ACTOR,
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                null,
            ]),
        )
        expect(
            model.state.events.filter((value) => value.startsWith('lock:')),
        ).toEqual([
            'lock:users:' + AUDIT_TEST_ACTOR + ':update',
            'lock:users:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:update',
        ])
        model.reset()
        await writeStandaloneAuditLogService({ ...event(), actorUserId: null })
        expect(
            model.state.events.some((value) => value.startsWith('lock:')),
        ).toBe(false)
    })
})
