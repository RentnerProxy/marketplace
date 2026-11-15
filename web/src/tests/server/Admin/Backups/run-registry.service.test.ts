import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createBackupAuditMocks,
    matchesBackupRunCondition,
} from './backupAuditTestUtils.ts'

const auditMocks = createBackupAuditMocks()
vi.mock('@/server/Realtime/publish.service.ts', function () {
    return { publishAdminBackupsChangedService: vi.fn() }
})
const initialRuns = [
    { id: 'run-1', status: 'queued', completedAt: null, errorMessage: null },
    {
        id: 'unrelated-run',
        status: 'running',
        completedAt: null,
        errorMessage: null,
    },
]
const state = {
    runs: structuredClone(initialRuns) as Array<Record<string, unknown>>,
    restoreValues: null as Record<string, unknown> | null,
    restoreUpdate: null as Record<string, unknown> | null,
}
const schema = {
    backupRuns: { id: 'backupRuns.id', status: 'backupRuns.status' },
}
const tx = {
    update: vi.fn(function () {
        return {
            set: function (values: Record<string, unknown>) {
                return {
                    where: function (condition: unknown) {
                        return {
                            returning: async function () {
                                auditMocks.state.events.push('run-update')
                                const matches = state.runs.filter((run) =>
                                    matchesBackupRunCondition(run, condition),
                                )
                                for (const run of matches)
                                    Object.assign(run, values)
                                return matches.map((run) => ({ id: run.id }))
                            },
                        }
                    },
                }
            },
        }
    }),
}
const database = {
    insert: vi.fn(function () {
        return {
            values: function (values: Record<string, unknown>) {
                state.restoreValues = values
                return {
                    onConflictDoUpdate: async function (options: {
                        set: Record<string, unknown>
                    }) {
                        state.restoreUpdate = options.set
                    },
                }
            },
        }
    }),
    transaction: vi.fn(async function <Result>(
        operation: (transaction: typeof tx) => Result | Promise<Result>,
    ) {
        const previous = structuredClone(state.runs)
        return auditMocks.transaction(tx, operation, function () {
            state.runs = previous
        })
    }),
}

vi.mock('@/db', function () {
    return { db: database }
})
vi.mock('@/db/schema.ts', function () {
    return schema
})
vi.mock('drizzle-orm', function () {
    return {
        and: (...conditions: Array<unknown>) => ({ type: 'and', conditions }),
        eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
        inArray: (left: unknown, right: unknown) => ({
            type: 'inArray',
            left,
            right,
        }),
        desc: (value: unknown) => value,
        lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
    }
})
vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService: auditMocks.prepare,
        writeAuditLogInTransactionService: auditMocks.write,
        publishCommittedAuditLogService: auditMocks.publish,
    }
})
vi.mock('@/lib/AuditLogs/user-locks.ts', function () {
    return { lockAuditUsersInTransactionService: auditMocks.lockUsers }
})
const { markRunAsQueueFailed, persistBackupRunAfterRestore } =
    await import('@/server/Admin/Backups/run-registry.service.ts')

describe('Backup-Queuefehler: Audit und Kompensation', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        state.runs = structuredClone(initialRuns)
        state.restoreValues = state.restoreUpdate = null
    })

    it('schreibt historische Fehler beim Erhalten alter Archiv-Runs nur als feste Meldung zurück', async function () {
        const run = {
            id: 'historical-run',
            status: 'failed',
            errorMessage: 'SELECT synthetic-secret FROM private_table',
            createdByUserId: 'old-actor',
        }
        await persistBackupRunAfterRestore(run as never)
        expect(state.restoreValues?.errorMessage).toBe(
            'Der Backup-Vorgang ist fehlgeschlagen.',
        )
        expect(state.restoreUpdate?.errorMessage).toBe(
            'Der Backup-Vorgang ist fehlgeschlagen.',
        )
        expect(state.restoreValues?.createdByUserId).toBeNull()
        expect(run.errorMessage).toContain('synthetic-secret')
        expect(
            JSON.stringify([state.restoreValues, state.restoreUpdate]),
        ).not.toContain('synthetic-secret')
    })

    it('persistiert ausschließlich die sichere Meldung ohne geworfene Werte auszulesen', async function () {
        const getter = vi.fn(function () {
            throw new Error('Getter must not run')
        })
        const toString = vi.fn(function () {
            throw new Error('Stringifier must not run')
        })
        const error = Object.create(null, {
            message: { get: getter },
            toString: { value: toString },
        })

        await markRunAsQueueFailed('run-1', error, 'actor-user')

        expect(state.runs[0]?.errorMessage).toBe(
            'Der Backup-Vorgang ist fehlgeschlagen.',
        )
        expect(getter).not.toHaveBeenCalled()
        expect(toString).not.toHaveBeenCalled()
        expect(JSON.stringify(auditMocks.state.records)).not.toContain(
            'Getter must not run',
        )
    })

    it('committet ausschließlich den aktiven eigenen Run mit Actor-Audit', async function () {
        await markRunAsQueueFailed(
            'run-1',
            new Error('synthetic queue error'),
            'actor-user',
        )

        expect(state.runs[0]).toMatchObject({
            status: 'failed',
            completedAt: expect.any(Date),
            errorMessage: 'Der Backup-Vorgang ist fehlgeschlagen.',
        })
        expect(state.runs[1]).toEqual(initialRuns[1])
        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({
                action: 'admin.backups.queue_failed',
                actorUserId: 'actor-user',
                newValues: { backupRunId: 'run-1', status: 'failed' },
            }),
        ])
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'run-update',
            'audit:admin.backups.queue_failed',
            'commit',
            'publish-audit',
        ])
    })

    it.each(['audit', 'commit'])(
        'rollt die Kompensation bei %s-Fehler zurück',
        async function (failure) {
            auditMocks.state.failAction =
                failure === 'audit' ? 'admin.backups.queue_failed' : null
            auditMocks.state.failCommit = failure === 'commit'

            await expect(
                markRunAsQueueFailed(
                    'run-1',
                    new Error('synthetic error'),
                    'actor-user',
                ),
            ).rejects.toThrow()

            expect(state.runs).toEqual(initialRuns)
            expect(auditMocks.state.records).toEqual([])
            expect(auditMocks.publish).not.toHaveBeenCalled()
        },
    )

    it.each(['completed', 'failed', 'deleted'])(
        'ändert einen %s-Run nicht und erfindet kein Audit',
        async function (status) {
            if (status === 'deleted')
                state.runs = state.runs.filter((run) => run.id !== 'run-1')
            else state.runs[0]!.status = status
            const previous = structuredClone(state.runs)

            await markRunAsQueueFailed(
                'run-1',
                new Error('synthetic delayed error'),
            )

            expect(state.runs).toEqual(previous)
            expect(auditMocks.write).not.toHaveBeenCalled()
            expect(auditMocks.publish).not.toHaveBeenCalled()
        },
    )

    it('auditiert die Worker-Kompensation ohne geerbten Requestkontext nur einmal', async function () {
        await markRunAsQueueFailed('run-1', new Error('synthetic worker error'))
        await markRunAsQueueFailed('run-1', new Error('duplicate worker error'))

        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({
                actorUserId: null,
                route: null,
                method: 'WORKER',
            }),
        ])
        expect(auditMocks.publish).toHaveBeenCalledTimes(1)
    })
})
