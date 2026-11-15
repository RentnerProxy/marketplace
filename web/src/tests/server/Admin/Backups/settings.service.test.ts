import {
    createBackupMutationMocks,
    backupMutationRevocations,
} from './backupMutationTestUtils.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { createBackupAuditMocks } from './backupAuditTestUtils.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
vi.mock('@/server/Realtime/publish.service.ts', function () {
    return { publishAdminBackupsChangedService: vi.fn() }
})
import { BACKUP_TARGET_KEY } from '@/config/backup.config.ts'
import {
    getOrCreateBackupSettings,
    getBackupOverviewService,
    updateBackupSettingsService,
} from '@/server/Admin/Backups/settings.service.ts'
import { syncBackupScheduler } from '@/server/Admin/Backups/backup.queue.ts'

const auditMocks = createBackupAuditMocks()
const mutationMocks = createBackupMutationMocks(auditMocks)

const schemaMock = (function () {
    return {
        ...mutationMocks.schema,
        backupRuns: {
            startedAt: 'backupRuns.startedAt',
            status: 'backupRuns.status',
            trigger: 'backupRuns.trigger',
        },
        backupSettings: {
            id: 'backupSettings.id',
        },
    }
})()

const settingsMocks = (function () {
    const defaultSettings = {
        id: 1,
        isEnabled: true,
        targetKey: 'nas',
        scheduleType: 'daily',
        scheduleInterval: 1,
        scheduleWeekdays: '1,2,3,4,5',
        scheduleHour: 3,
        scheduleMinute: 0,
        retentionMode: 'both',
        retentionDays: 30,
        retentionCount: 10,
        includeStorage: false,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedByUserId: null,
    }
    const state = {
        selectedSettings: { ...defaultSettings },
        persistedSettings: { ...defaultSettings } as Record<string, unknown>,
        pendingInsert: {} as Record<string, unknown>,
        updateReturning: [] as Array<Record<string, unknown>>,
        selectedRuns: [] as Array<Record<string, unknown>>,
    }
    const selectLimit = vi.fn(async function () {
        return [state.selectedSettings]
    })
    const selectWhere = vi.fn(function () {
        return { limit: selectLimit }
    })
    const selectFrom = vi.fn(function (table: unknown) {
        if (table === schemaMock.backupRuns) {
            return Object.assign(
                Promise.resolve([{ total: state.selectedRuns.length }]),
                {
                    orderBy: function () {
                        return {
                            limit: async function () {
                                return state.selectedRuns
                            },
                        }
                    },
                },
            )
        }
        return { where: selectWhere }
    })
    const select = vi.fn(function (projection?: unknown) {
        if (mutationMocks.isPolicySelection(projection)) {
            return mutationMocks.selectPolicy(tx, projection)
        }
        return { from: selectFrom }
    })
    const onConflictDoNothing = vi.fn(async function () {})
    const returning = vi.fn(async function () {
        auditMocks.state.events.push('settings-upsert')
        Object.assign(state.persistedSettings, state.pendingInsert)
        return state.updateReturning
    })
    const onConflictDoUpdate = vi.fn(function () {
        return { returning }
    })
    const insertValues = vi.fn(function (values: Record<string, unknown>) {
        state.pendingInsert = values
        return { onConflictDoNothing, onConflictDoUpdate }
    })
    const insert = vi.fn(function () {
        return { values: insertValues }
    })
    const updateWhere = vi.fn(async function () {})
    const updateSet = vi.fn(function () {
        return { where: updateWhere }
    })
    const update = vi.fn(function () {
        return { set: updateSet }
    })

    const tx = { insert, select, update }
    const transaction = vi.fn(async function <Result>(
        operation: (transaction: typeof tx) => Result | Promise<Result>,
    ) {
        const previous = structuredClone(state.persistedSettings)
        return auditMocks.transaction(tx, operation, function () {
            state.persistedSettings = previous
        })
    })
    return {
        database: {
            ...tx,
            transaction,
            select: vi.fn(function (projection?: unknown) {
                if (mutationMocks.isPolicySelection(projection))
                    throw new Error('Unexpected global policy read')
                return select(projection)
            }),
        },
        tx,
        defaultSettings,
        insertValues,
        onConflictDoUpdate,
        state,
        updateSet,
    }
})()

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService: auditMocks.prepare,
        writeAuditLogInTransactionService: auditMocks.write,
        publishCommittedAuditLogService: auditMocks.publish,
    }
})
vi.mock('@/lib/AuditLogs/user-locks.ts', function () {
    return { lockAuditUsersInTransactionService: mutationMocks.lockUsers }
})

vi.mock('@/db', function () {
    return { db: settingsMocks.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        desc: vi.fn(function (value: unknown) {
            return value
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
        sql: function () {
            return 'sql'
        },
    }
})

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    return {
        getNextScheduledBackupAt: vi.fn(),
        syncBackupScheduler: vi.fn(async function () {}),
    }
})

const updateInput = {
    isEnabled: true,
    scheduleType: 'daily' as const,
    scheduleInterval: 1,
    scheduleWeekdays: '1,2,3,4,5',
    scheduleHour: 3,
    scheduleMinute: 0,
    retentionMode: 'both' as const,
    retentionDays: 30,
    retentionCount: 10,
    includeStorage: false,
}

describe('Backup-Einstellungen', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        mutationMocks.reset()
        settingsMocks.state.persistedSettings = structuredClone(
            settingsMocks.defaultSettings,
        )
        settingsMocks.state.selectedSettings = {
            ...settingsMocks.defaultSettings,
        }
        settingsMocks.state.updateReturning = []
        settingsMocks.state.selectedRuns = []
    })

    it('redigiert gespeicherte Legacy-Fehlertexte in der gesamten Runübersicht', async function () {
        settingsMocks.state.selectedRuns = [
            {
                id: 'failed-run',
                trigger: 'manual',
                status: 'failed',
                startedAt: new Date('2026-01-01T00:00:00Z'),
                completedAt: null,
                errorMessage:
                    'SELECT synthetic-secret FROM private_table; C:\\private\\backup',
            },
            {
                id: 'completed-run',
                trigger: 'manual',
                status: 'completed',
                startedAt: new Date('2026-01-01T00:00:00Z'),
                completedAt: new Date('2026-01-01T00:05:00Z'),
                errorMessage: null,
            },
        ]
        const overview = await getBackupOverviewService()
        expect(overview.runs[0].errorMessage).toBe(
            'Der Backup-Vorgang ist fehlgeschlagen.',
        )
        expect(overview.runs[1].errorMessage).toBeNull()
        expect(overview.runs[1].completedAt).toBe('2026-01-01T00:05:00.000Z')
        expect(JSON.stringify(overview)).not.toContain('synthetic-secret')
        expect(settingsMocks.state.selectedRuns[0].errorMessage).toContain(
            'synthetic-secret',
        )
    })

    it('normalisiert ein gespeichertes Legacy-Ziel auf den festen Backup-Ordner', async function () {
        const settings = await getOrCreateBackupSettings()

        expect(settings.targetKey).toBe(BACKUP_TARGET_KEY)
        expect(settingsMocks.updateSet).toHaveBeenCalledWith({
            targetKey: BACKUP_TARGET_KEY,
            updatedAt: expect.any(Date),
        })
    })

    it('ignoriert eine eingeschleuste Zielwahl beim Speichern', async function () {
        settingsMocks.state.updateReturning = [
            {
                ...settingsMocks.defaultSettings,
                ...updateInput,
                targetKey: BACKUP_TARGET_KEY,
            },
        ]

        const result = await updateBackupSettingsService(
            { ...updateInput, targetKey: 'nas' } as never,
            'user-1',
        )

        expect(settingsMocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                ...updateInput,
                targetKey: BACKUP_TARGET_KEY,
                updatedByUserId: 'user-1',
            }),
        )
        expect(settingsMocks.onConflictDoUpdate).toHaveBeenCalledWith({
            target: schemaMock.backupSettings.id,
            set: expect.objectContaining({
                ...updateInput,
                targetKey: BACKUP_TARGET_KEY,
                updatedByUserId: 'user-1',
            }),
        })
        expect(result.settings.targetKey).toBe(BACKUP_TARGET_KEY)
        expect(syncBackupScheduler).toHaveBeenCalledWith(
            expect.objectContaining({ targetKey: BACKUP_TARGET_KEY }),
        )
    })

    it('rollt Einstellungen bei Auditfehler zurück und startet keinen Scheduler', async function () {
        settingsMocks.state.updateReturning = [
            { ...settingsMocks.defaultSettings, ...updateInput },
        ]
        const previous = structuredClone(settingsMocks.state.persistedSettings)
        auditMocks.state.failAction = 'admin.backups.settings_updated'

        await expect(
            updateBackupSettingsService(updateInput, 'user-1'),
        ).rejects.toThrow('audit insert')

        expect(settingsMocks.state.persistedSettings).toEqual(previous)
        expect(auditMocks.state.records).toEqual([])
        expect(syncBackupScheduler).not.toHaveBeenCalled()
        expect(auditMocks.publish).not.toHaveBeenCalled()
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'settings-upsert',
            'audit:admin.backups.settings_updated',
            'rollback',
        ])
    })

    it('bewahrt Einstellungen und Audit bei nachträglichem Schedulerfehler', async function () {
        settingsMocks.state.updateReturning = [
            { ...settingsMocks.defaultSettings, ...updateInput },
        ]
        const scheduler = syncBackupScheduler as ReturnType<
            typeof vi.fn<typeof syncBackupScheduler>
        >
        scheduler.mockRejectedValueOnce(
            new Error('synthetic scheduler unavailable'),
        )

        await expect(
            updateBackupSettingsService(updateInput, 'user-1'),
        ).rejects.toThrow('scheduler unavailable')

        expect(settingsMocks.state.persistedSettings.updatedByUserId).toBe(
            'user-1',
        )
        expect(auditMocks.state.records).toHaveLength(1)
        expect(auditMocks.state.records[0]?.actorUserId).toBe('user-1')
        expect(auditMocks.publish).toHaveBeenCalledWith(auditMocks.receipt)
        expect(auditMocks.state.events.indexOf('commit')).toBeLessThan(
            auditMocks.state.events.indexOf('publish-audit'),
        )
    })

    it('startet ohne bestätigten Commit keinen Scheduler', async function () {
        settingsMocks.state.updateReturning = [
            { ...settingsMocks.defaultSettings, ...updateInput },
        ]
        const previous = structuredClone(settingsMocks.state.persistedSettings)
        auditMocks.state.failCommit = true

        await expect(
            updateBackupSettingsService(updateInput, 'user-1'),
        ).rejects.toThrow('commit failed')

        expect(settingsMocks.state.persistedSettings).toEqual(previous)
        expect(auditMocks.state.records).toEqual([])
        expect(syncBackupScheduler).not.toHaveBeenCalled()
    })

    it.each(backupMutationRevocations)(
        'schreibt keine Settings bei Actor-Widerruf vor dem Lock: %s',
        async function (revocation) {
            mutationMocks.revokeAtLock(revocation)
            const previous = structuredClone(
                settingsMocks.state.persistedSettings,
            )
            await expect(
                updateBackupSettingsService(updateInput, 'actor-policy'),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(settingsMocks.insertValues).not.toHaveBeenCalled()
            expect(settingsMocks.updateSet).not.toHaveBeenCalled()
            expect(settingsMocks.state.persistedSettings).toEqual(previous)
            expect(auditMocks.state.records).toEqual([])
            expect(auditMocks.publish).not.toHaveBeenCalled()
            expect(syncBackupScheduler).not.toHaveBeenCalled()
        },
    )

    it('verwendet den übergebenen Executor für Initialisierung, Lesen und Zielkorrektur', async function () {
        const inserted = vi.fn(async function () {})
        const corrected = vi.fn(async function () {})
        const selectLimit = vi.fn(async function () {
            return [settingsMocks.defaultSettings]
        })
        const executor = {
            insert: vi.fn(function () {
                return {
                    values: vi.fn(function () {
                        return { onConflictDoNothing: inserted }
                    }),
                }
            }),
            select: vi.fn(function () {
                return {
                    from: vi.fn(function () {
                        return {
                            where: vi.fn(function () {
                                return { limit: selectLimit }
                            }),
                        }
                    }),
                }
            }),
            update: vi.fn(function () {
                return {
                    set: vi.fn(function () {
                        return { where: corrected }
                    }),
                }
            }),
        }
        const result = await getOrCreateBackupSettings(executor as never)
        expect(result.targetKey).toBe(BACKUP_TARGET_KEY)
        expect(inserted).toHaveBeenCalledTimes(1)
        expect(selectLimit).toHaveBeenCalledTimes(1)
        expect(corrected).toHaveBeenCalledTimes(1)
        expect(settingsMocks.database.insert).not.toHaveBeenCalled()
        expect(settingsMocks.database.select).not.toHaveBeenCalled()
        expect(settingsMocks.database.update).not.toHaveBeenCalled()
    })
})
