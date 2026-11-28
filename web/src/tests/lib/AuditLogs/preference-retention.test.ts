import { beforeEach, describe, expect, it } from 'bun:test'
import {
    PREFERENCE_AUDIT_ACTIONS,
    PREFERENCE_AUDIT_RETENTION,
} from '@/config/audit.config.ts'
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
    writeStandaloneAuditLogService,
} = await import('@/lib/AuditLogs/auditLogs.ts')
const { lockAuditUsersInTransactionService } =
    await import('@/lib/AuditLogs/user-locks.ts')
const otherActor = '22222222-2222-4222-8222-222222222222'

function seed(
    count: number,
    actorUserId: string | null = AUDIT_TEST_ACTOR,
    action = 'user.theme_mode_updated',
    prefix = 'old',
) {
    const rows = Array.from({ length: count }, (_, index) => ({
        id: prefix + '-' + String(index).padStart(5, '0'),
        createdAt: new Date(Date.UTC(2026, 0, 1) + index),
        actorUserId,
        action,
        route: '/settings',
        method: 'POST',
    }))
    model.state.audits.push(...rows)
    return rows
}

function input(
    action = 'user.theme_mode_updated',
    actorUserId: string | null = AUDIT_TEST_ACTOR,
) {
    return { ...prepareAuditContextService(actorUserId), action }
}

function write(
    action = 'user.theme_mode_updated',
    actorUserId: string | null = AUDIT_TEST_ACTOR,
) {
    return db.transaction(async function (transaction) {
        await lockAuditUsersInTransactionService(transaction, [actorUserId])
        return writeAuditLogInTransactionService(
            transaction,
            input(action, actorUserId),
        )
    })
}

describe('bounded ordinary-preference audit history', function () {
    beforeEach(function () {
        model.reset()
    })

    it('uses a finite per-actor cap and deletion batch for the exact ordinary action inventory', function () {
        expect(PREFERENCE_AUDIT_RETENTION).toEqual({
            maximumRowsPerActor: 1_000,
            maximumDeletesPerWrite: 100,
        })
        expect([...PREFERENCE_AUDIT_ACTIONS].toSorted()).toEqual([
            'user.background_appearance_updated',
            'user.background_delete_started',
            'user.background_deleted',
            'user.background_update_started',
            'user.background_updated',
            'user.bio_updated',
            'user.font_family_updated',
            'user.font_size_updated',
            'user.primary_color_reset',
            'user.primary_color_updated',
            'user.profile_image_update_started',
            'user.profile_image_updated',
            'user.theme_mode_updated',
        ])
    })

    for (const action of PREFERENCE_AUDIT_ACTIONS) {
        it(
            'bounds the shared ordinary history when inserting ' + action,
            async function () {
                seed(1_000)
                const receipt = await write(action)
                expect(model.state.audits).toHaveLength(1_000)
                expect(model.state.deletedAuditIds).toEqual(['old-00000'])
                expect(
                    model.state.audits.find((row) => row.id === receipt.id)
                        ?.action,
                ).toBe(action)
                expect(
                    model.state.events.indexOf('insert:auditLogs'),
                ).toBeLessThan(model.state.events.indexOf('read:auditLogs'))
            },
        )
    }

    for (const previousCount of [0, 998, 999]) {
        it(
            'retains all existing records when starting with ' + previousCount,
            async function () {
                seed(previousCount)
                await write()
                expect(model.state.audits).toHaveLength(previousCount + 1)
                expect(model.state.deletedAuditIds).toEqual([])
                expect(model.state.events).not.toContain('delete:auditLogs')
            },
        )
    }

    it('never prunes another actor, anonymous records, security, administration or unknown actions', async function () {
        const own = seed(1_000)
        const foreign = seed(
            1_050,
            otherActor,
            'user.background_updated',
            'foreign',
        )
        const anonymous = seed(
            1_050,
            null,
            'user.font_size_updated',
            'anonymous',
        )
        const protectedActions = [
            'auth.login',
            'auth.logout',
            'user.password_reset_requested',
            'user.two_factor_setup_started',
            'user.two_factor_enabled',
            'user.two_factor_disabled',
            'user.passkey_registered',
            'user.permissions_updated',
            'admin.user_updated',
            'admin.permission_deleted',
            'maintenance.started',
            'user.background_updated_extra',
            'user.theme_mode_updated.security',
            'USER.THEME_MODE_UPDATED',
            'unknown.future_action',
        ]
        const protectedRows = protectedActions.flatMap((action, index) =>
            seed(1, AUDIT_TEST_ACTOR, action, 'protected-' + index),
        )
        const receipt = await write()
        expect(model.state.deletedAuditIds).toEqual([own[0]!.id])
        expect(model.state.audits).toEqual(
            expect.arrayContaining([
                ...foreign,
                ...anonymous,
                ...protectedRows,
            ]),
        )
        expect(model.state.audits.some((row) => row.id === receipt.id)).toBe(
            true,
        )
        expect(
            model.state.audits.filter(
                (row) => row.actorUserId === AUDIT_TEST_ACTOR,
            ),
        ).toHaveLength(1_000 + protectedRows.length)
    })

    it('does not invoke retention for security, unknown or anonymous audit writes', async function () {
        seed(1_500)
        await write('user.two_factor_enabled')
        await write('user.background_updated_extra')
        await write('user.theme_mode_updated', null)
        expect(model.state.audits).toHaveLength(1_503)
        expect(model.state.retentionReadLimits).toEqual([])
        expect(model.state.deletedAuditIds).toEqual([])
    })

    it('deletes the oldest timestamp first and uses the id to break timestamp ties', async function () {
        seed(998)
        const newestFirst = [...model.state.audits].toReversed()
        model.state.audits = newestFirst
        model.state.audits.push(
            {
                ...newestFirst[0]!,
                id: 'z-old',
                createdAt: new Date('2025-01-01'),
            },
            {
                ...newestFirst[0]!,
                id: 'a-old',
                createdAt: new Date('2025-01-01'),
            },
        )
        await write()
        expect(model.state.deletedAuditIds).toEqual(['a-old'])
        expect(model.state.audits.some((row) => row.id === 'z-old')).toBe(true)
    })

    it('always excludes the current receipt even with an older transaction timestamp', async function () {
        seed(1_000)
        model.state.auditCreatedAt = new Date('2020-01-01')
        const receipt = await write()
        expect(model.state.deletedAuditIds).toEqual(['old-00000'])
        expect(
            model.state.audits.find((row) => row.id === receipt.id)?.createdAt,
        ).toEqual(new Date('2020-01-01'))
        expect(model.state.audits).toHaveLength(1_000)
    })

    it('shrinks an oversized legacy history in bounded FIFO batches without cleanup audit growth', async function () {
        const old = seed(5_000)
        await writeStandaloneAuditLogService(input())
        expect(model.state.audits).toHaveLength(4_901)
        expect(model.state.deletedAuditIds).toEqual(
            old.slice(0, 100).map((row) => row.id),
        )
        expect(model.state.retentionReadLimits).toEqual([1_099])
        expect(model.publish).toHaveBeenCalledTimes(1)

        await writeStandaloneAuditLogService(input())
        expect(model.state.audits).toHaveLength(4_802)
        expect(model.state.deletedAuditIds).toEqual(
            old.slice(0, 200).map((row) => row.id),
        )
        expect(model.state.retentionReadLimits).toEqual([1_099, 1_099])
        expect(model.publish).toHaveBeenCalledTimes(2)
        expect(
            model.state.audits.filter((row) => row.id.startsWith('audit-')),
        ).toHaveLength(2)
        expect(
            model.state.audits.every(
                (row) => row.action === 'user.theme_mode_updated',
            ),
        ).toBe(true)
    })

    for (const failure of ['prune', 'commit']) {
        it(
            'rolls back preference, new audit and removed history after ' +
                failure +
                ' failure',
            async function () {
                const old = structuredClone(seed(1_000))
                model.state.rows.set('domain', { theme: 'before' })
                model.state.failPrune = failure === 'prune'
                model.state.failCommit = failure === 'commit'
                await expect(
                    db.transaction(async function (transaction) {
                        await lockAuditUsersInTransactionService(transaction, [
                            AUDIT_TEST_ACTOR,
                        ])
                        model.state.rows.set('domain', { theme: 'after' })
                        return writeAuditLogInTransactionService(
                            transaction,
                            input(),
                        )
                    }),
                ).rejects.toThrow('synthetic ' + failure + ' failure')
                expect(model.state.rows.get('domain')).toEqual({
                    theme: 'before',
                })
                expect(model.state.audits).toEqual(old)
                expect(model.state.events).toContain('delete:auditLogs')
                expect(model.state.events.at(-1)).toBe('rollback')
                expect(model.publish).not.toHaveBeenCalled()
            },
        )
    }

    for (const failure of ['insert', 'receipt']) {
        it(
            'does not begin pruning before a valid persisted receipt on ' +
                failure +
                ' failure',
            async function () {
                const old = structuredClone(seed(1_000))
                model.state.failAction =
                    failure === 'insert' ? 'user.theme_mode_updated' : null
                model.state.auditReceipts = failure === 'receipt' ? [] : null
                await expect(write()).rejects.toThrow()
                expect(model.state.audits).toEqual(old)
                expect(model.state.retentionReadLimits).toEqual([])
                expect(model.state.deletedAuditIds).toEqual([])
                expect(model.publish).not.toHaveBeenCalled()
            },
        )
    }

    it('rejects retention without the required caller actor lock in the transaction model', async function () {
        seed(1_000)
        await expect(
            db.transaction((transaction) =>
                writeAuditLogInTransactionService(transaction, input()),
            ),
        ).rejects.toThrow('caller actor lock')
        expect(model.state.audits).toHaveLength(1_000)
        expect(model.state.deletedAuditIds).toEqual([])
    })

    it('keeps concurrent same-actor writes within the cap under the caller lock contract', async function () {
        seed(1_000)
        const locked = Promise.withResolvers<void>()
        const continueFirst = Promise.withResolvers<void>()
        const first = db.transaction(async function (transaction) {
            await lockAuditUsersInTransactionService(transaction, [
                AUDIT_TEST_ACTOR,
            ])
            locked.resolve()
            await continueFirst.promise
            return writeAuditLogInTransactionService(transaction, input())
        })
        await locked.promise
        const otherWrites = Array.from({ length: 7 }, () => write())
        try {
            expect(model.state.audits).toHaveLength(1_000)
            expect(
                model.state.events.filter((event) => event === 'begin'),
            ).toHaveLength(1)
        } finally {
            continueFirst.resolve()
        }
        const receipts = await Promise.all([first, ...otherWrites])
        expect(model.state.audits).toHaveLength(1_000)
        expect(model.state.deletedAuditIds).toHaveLength(8)
        expect(model.state.retentionReadLimits).toEqual(
            Array.from({ length: 8 }, () => 1_099),
        )
        for (const receipt of receipts)
            expect(
                model.state.audits.some((row) => row.id === receipt.id),
            ).toBe(true)
        const expectedLock = 'lock:users:' + AUDIT_TEST_ACTOR + ':update'
        expect(
            model.state.events.filter((event) => event === expectedLock),
        ).toHaveLength(8)
        const transactions = model.state.events
            .join('|')
            .split('begin|')
            .slice(1)
        for (const transaction of transactions) {
            expect(transaction.indexOf(expectedLock)).toBeLessThan(
                transaction.indexOf('insert:auditLogs'),
            )
            expect(transaction.indexOf('delete:auditLogs')).toBeLessThan(
                transaction.indexOf('commit'),
            )
        }
    })
})
