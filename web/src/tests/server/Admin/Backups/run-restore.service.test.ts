import {
    createBackupMutationMocks,
    backupMutationRevocations,
} from './backupMutationTestUtils.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { createBackupAuditMocks } from './backupAuditTestUtils.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    enqueueRestoreBackupService,
    executeRestoreBackup,
} from '@/server/Admin/Backups/run-restore.service.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'
import type { RestoreBackupArchiveInput } from '@/server/Admin/Backups/Types/backup-service.types.ts'

const auditMocks = createBackupAuditMocks()
const mutationMocks = createBackupMutationMocks(auditMocks)

const schemaMock = (function () {
    return {
        ...mutationMocks.schema,
        backupRuns: {
            fileName: 'backupRuns.fileName',
            id: 'backupRuns.id',
            includesStorage: 'backupRuns.includesStorage',
            status: 'backupRuns.status',
            trigger: 'backupRuns.trigger',
        },
    }
})()

const restoreMocks = (function () {
    const ids = {
        restore: '019f5b07-80e2-7000-8000-000000000001',
        source: '019f5b07-80e2-7000-8000-000000000002',
    }
    const checksumSha256 = 'a'.repeat(64)
    const initiatingSessionHash = 'b'.repeat(64)
    const state = {
        fileRuns: [] as Array<Record<string, unknown>>,
        createdRuns: [] as Array<Record<string, unknown>>,
        restoreRun: {
            id: ids.restore,
            trigger: 'restore',
            status: 'queued',
            targetKey: 'local',
            includesStorage: true,
            fileName: null,
            fileSize: null,
            checksumSha256: null,
            errorMessage: null,
            startedAt: new Date('2026-01-01T12:00:00.000Z'),
            completedAt: null,
            createdByUserId: 'user-1',
        } as Record<string, unknown>,
        sourceRun: {
            id: ids.source,
            trigger: 'manual',
            status: 'completed',
            targetKey: 'local',
            includesStorage: true,
            fileName: 'source.tanstack-backup.tar',
            fileSize: 1_024,
            checksumSha256,
            errorMessage: null,
            startedAt: new Date('2026-01-01T10:00:00.000Z'),
            completedAt: new Date('2026-01-01T10:01:00.000Z'),
            createdByUserId: 'user-1',
        } as Record<string, unknown>,
        initiatorSession: {
            id: initiatingSessionHash,
            userId: 'user-1',
            ip: '127.0.0.1',
            location: 'Zürich',
            device: 'Desktop',
            browser: 'Firefox',
            expiresAt: new Date('2026-09-01T12:00:00.000Z'),
        },
    }
    const transaction = vi.fn(async function (
        callback: (transaction: unknown) => unknown | Promise<unknown>,
    ) {
        return callback({})
    })
    const updateReturning = vi.fn(async function () {
        return [
            {
                id: ids.restore,
                includesStorage: state.restoreRun.includesStorage,
            },
        ]
    })
    const updateWhere = vi.fn(function () {
        return { returning: updateReturning }
    })
    const updateSet = vi.fn(function () {
        return { where: updateWhere }
    })
    const selectWhere = vi.fn(async function () {
        return state.fileRuns
    })
    const selectFrom = vi.fn(function () {
        return { where: selectWhere }
    })
    const database = {
        select: vi.fn(function () {
            return { from: selectFrom }
        }),
        transaction,
        update: vi.fn(function () {
            return { set: updateSet }
        }),
    }
    const getRun = vi.fn(async function (runId: string) {
        if (runId === ids.restore) {
            return state.restoreRun
        }

        if (runId === ids.source) {
            lifecycle.push('source:read')
            return state.sourceRun
        }

        return null
    })
    const persistRun = vi.fn(async function (run: Record<string, unknown>) {
        lifecycle.push(`run:${String(run.id)}:${String(run.status)}`)
    })
    const restoreArchive = vi.fn(async function (
        input: RestoreBackupArchiveInput,
    ) {
        lifecycle.push('archive:entered')
        await input.beforeRestoreMutation?.()
        lifecycle.push('archive:mutating')
        await input.afterDatabaseRestore?.()
        await input.afterRestoreApplied?.()
        lifecycle.push('archive:recovery-cleanup')
        lifecycle.push('archive-complete')
    })
    const lifecycle: Array<string> = []
    const journalAppend = vi.fn(async function (phase: string) {
        lifecycle.push(`journal:${phase}`)
    })
    const journalClose = vi.fn(async function () {
        lifecycle.push('journal:closed')
    })

    return {
        applyRetention: vi.fn(async function (_protectedIds?: Set<string>) {}),
        checksumSha256,
        createJournal: vi.fn(async function (_binding: unknown) {
            lifecycle.push('journal:started')
            return { append: journalAppend, close: journalClose }
        }),
        database,
        exclusiveBarrier: vi.fn(async function <TResult>(
            operation: () => Promise<TResult>,
        ) {
            lifecycle.push('barrier:entered')
            try {
                return await operation()
            } finally {
                lifecycle.push('barrier:left')
            }
        }),
        getBackupFilePath: vi.fn(async function (fileName: string) {
            return `C:\\Backups\\${fileName}`
        }),
        getBackupSettings: vi.fn(async function () {
            return { isEnabled: false }
        }),
        getInitiatorSession: vi.fn(async function () {
            lifecycle.push('actor-session:validated')
            return state.initiatorSession
        }),
        getSessionBinding: vi.fn(async function (): Promise<string | null> {
            return initiatingSessionHash
        }),
        getRun,
        ids,
        initiatingSessionHash,
        journalAppend,
        journalClose,
        lifecycle,
        logError: vi.fn(),
        markQueueFailed: vi.fn(async function () {}),
        persistRun,
        publishReauthentication: vi.fn(async function () {}),
        publishRestoreState: vi.fn(async function () {}),
        queueAdd: vi.fn(async function () {
            lifecycle.push('queue:added')
            auditMocks.state.events.push('queue')
        }),
        replaceAuthState: vi.fn(async function () {
            lifecycle.push('auth:reconciled')
            return true
        }),
        removeSessionBinding: vi.fn(async function () {
            lifecycle.push('binding:removed')
        }),
        restoreArchive,
        saveSessionBinding: vi.fn(async function () {
            lifecycle.push('binding:saved')
            auditMocks.state.events.push('binding')
        }),
        writeRestoreState: vi.fn(async function (
            input: Record<string, unknown>,
        ) {
            lifecycle.push(`marker:${String(input.status)}`)
            return { version: 1, ...input }
        }),
        serializeBackupSettings: vi.fn(function (settings: unknown) {
            return settings
        }),
        state,
        statFile: vi.fn(async function (_filePath: string) {
            return {
                isFile: function () {
                    return true as const
                },
                size: state.sourceRun.fileSize,
            }
        }),
        syncScheduler: vi.fn(async function () {}),
        transaction,
        updateReturning,
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
    return { db: restoreMocks.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return conditions
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
        inArray: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
        isNotNull: vi.fn(function (value: unknown) {
            return value
        }),
        sql: vi.fn(function (strings: TemplateStringsArray) {
            return strings.join('')
        }),
    }
})

vi.mock('node:fs/promises', function () {
    return { stat: restoreMocks.statFile }
})

vi.mock('node:timers/promises', function () {
    return { setTimeout: vi.fn(async function () {}) }
})

vi.mock('@/config/backup.config.ts', function () {
    return { BACKUP_TARGET_KEY: 'local' }
})

vi.mock('@/server/Admin/Backups/archive-restore.service.ts', function () {
    return {
        restoreBackupArchive: restoreMocks.restoreArchive,
    }
})

vi.mock('@/server/Admin/Backups/restore-journal.service.ts', function () {
    return { createRestoreJournalService: restoreMocks.createJournal }
})

vi.mock('@/server/Admin/Backups/backup-directory.service.ts', function () {
    return { getBackupFilePath: restoreMocks.getBackupFilePath }
})

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    return {
        getBackupQueue: vi.fn(function () {
            return { add: restoreMocks.queueAdd }
        }),
        syncBackupScheduler: restoreMocks.syncScheduler,
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return {
        getBackupRunById: restoreMocks.getRun,
        markRunAsQueueFailed: restoreMocks.markQueueFailed,
        persistBackupRunAfterRestore: restoreMocks.persistRun,
    }
})

vi.mock('@/server/Admin/Backups/run-retention.service.ts', function () {
    return { applyBackupRetentionBestEffort: restoreMocks.applyRetention }
})

vi.mock('@/server/Admin/Backups/restore-session.service.ts', function () {
    return {
        consumeRestoreInitiatorSessionBindingService:
            restoreMocks.getSessionBinding,
        deleteRestoreInitiatorSessionBindingBestEffortService:
            restoreMocks.removeSessionBinding,
        getRestoreInitiatorSessionService: restoreMocks.getInitiatorSession,
        replaceRestoredAuthenticationStateService:
            restoreMocks.replaceAuthState,
        saveRestoreInitiatorSessionBindingService:
            restoreMocks.saveSessionBinding,
    }
})

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return {
        getRestoreStateService: vi.fn(async function () {
            return {
                version: 1,
                status: 'running',
                phase: 'preparing',
                percent: 0,
                processedBytes: 0,
                totalBytes: 0,
                startedAt: '2026-01-01T12:00:00.000Z',
                updatedAt: '2026-01-01T12:00:00.000Z',
            }
        }),
        getRestoreStateFromProgress: vi.fn(function (
            progress: Record<string, unknown>,
            startedAt: string,
        ) {
            return {
                status: 'running',
                ...progress,
                startedAt,
            }
        }),
        writeRestoreStateService: restoreMocks.writeRestoreState,
    }
})

vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        withExclusiveStorageMutationBarrier: restoreMocks.exclusiveBarrier,
    }
})

vi.mock('@/server/Admin/Backups/settings.service.ts', function () {
    return {
        getOrCreateBackupSettings: restoreMocks.getBackupSettings,
        serializeBackupSettings: restoreMocks.serializeBackupSettings,
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: restoreMocks.logError }
})

vi.mock('@/server/Realtime/publish.service.ts', function () {
    return {
        publishRealtimeReauthenticationRequiredService:
            restoreMocks.publishReauthentication,
        publishSystemRestoreChangedService: restoreMocks.publishRestoreState,
    }
})

function createEnqueueTransaction() {
    let selectCallCount = 0

    const transaction = {
        execute: vi.fn(async function () {
            auditMocks.state.events.push('restore-advisory-lock')
        }),
        insert: vi.fn(function () {
            return {
                values: vi.fn(function (values: Record<string, unknown>) {
                    return {
                        returning: vi.fn(async function () {
                            auditMocks.state.events.push('run-insert')
                            restoreMocks.state.createdRuns.push(
                                structuredClone(values),
                            )
                            return [{ id: restoreMocks.ids.restore }]
                        }),
                    }
                }),
            }
        }),
        select: vi.fn(function (projection?: unknown) {
            if (mutationMocks.isPolicySelection(projection)) {
                return mutationMocks.selectPolicy(transaction, projection)
            }
            selectCallCount += 1

            if (selectCallCount === 1) {
                return {
                    from: function () {
                        return {
                            where: function () {
                                return {
                                    limit: async function () {
                                        return []
                                    },
                                }
                            },
                        }
                    },
                }
            }

            return {
                from: function () {
                    return {
                        where: function () {
                            return {
                                limit: function () {
                                    return {
                                        for: async function () {
                                            auditMocks.state.events.push(
                                                'source-lock',
                                            )
                                            return [
                                                restoreMocks.state.sourceRun,
                                            ]
                                        },
                                    }
                                },
                            }
                        },
                    }
                },
            }
        }),
    }
    return transaction
}

function useEnqueueTransaction() {
    const enqueueTransaction = createEnqueueTransaction()
    restoreMocks.transaction.mockImplementationOnce(async function (
        callback: (transaction: unknown) => unknown | Promise<unknown>,
    ) {
        const previous = structuredClone(restoreMocks.state.createdRuns)
        return auditMocks.transaction(
            enqueueTransaction,
            callback,
            function () {
                restoreMocks.state.createdRuns = previous
            },
        )
    })
}

function createRestoreJob() {
    return {
        contractVersion: 2 as const,
        kind: 'restore' as const,
        runId: restoreMocks.ids.restore,
        sourceBackupId: restoreMocks.ids.source,
    }
}

describe('Restore-Orchestrierung', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        mutationMocks.reset()
        restoreMocks.state.createdRuns = []
        restoreMocks.state.restoreRun = {
            id: restoreMocks.ids.restore,
            trigger: 'restore',
            status: 'queued',
            targetKey: 'local',
            includesStorage: true,
            fileName: null,
            fileSize: null,
            checksumSha256: null,
            errorMessage: null,
            startedAt: new Date('2026-01-01T12:00:00.000Z'),
            completedAt: null,
            createdByUserId: 'user-1',
        }
        restoreMocks.state.sourceRun = {
            id: restoreMocks.ids.source,
            trigger: 'manual',
            status: 'completed',
            targetKey: 'local',
            includesStorage: true,
            fileName: 'source.tanstack-backup.tar',
            fileSize: 1_024,
            checksumSha256: restoreMocks.checksumSha256,
            errorMessage: null,
            startedAt: new Date('2026-01-01T10:00:00.000Z'),
            completedAt: new Date('2026-01-01T10:01:00.000Z'),
            createdByUserId: 'user-1',
        }
        restoreMocks.state.fileRuns = [restoreMocks.state.sourceRun]
        restoreMocks.statFile.mockImplementation(async function (
            filePath: string,
        ) {
            return {
                isFile: function () {
                    return true as const
                },
                size: filePath.includes('source.tanstack-backup.tar')
                    ? restoreMocks.state.sourceRun.fileSize
                    : 1_024,
            }
        })
        restoreMocks.lifecycle.length = 0
        restoreMocks.journalAppend
            .mockReset()
            .mockImplementation(async function (phase: string) {
                restoreMocks.lifecycle.push(`journal:${phase}`)
            })
        restoreMocks.journalClose
            .mockReset()
            .mockImplementation(async function () {
                restoreMocks.lifecycle.push('journal:closed')
            })
        restoreMocks.createJournal
            .mockReset()
            .mockImplementation(async function () {
                restoreMocks.lifecycle.push('journal:started')
                return {
                    append: restoreMocks.journalAppend,
                    close: restoreMocks.journalClose,
                }
            })
    })

    it('wendet ausschließlich die Source an und persistiert den erfolgreichen Lauf', async function () {
        await expect(
            executeRestoreBackup(
                {
                    contractVersion: 2,
                    kind: 'restore',
                    runId: restoreMocks.ids.restore,
                    sourceBackupId: restoreMocks.ids.source,
                },
                {
                    completeRestoreQuiescence: async function (
                        publishCompletedState,
                    ) {
                        restoreMocks.lifecycle.push('quiescence:start')
                        await publishCompletedState()
                        restoreMocks.lifecycle.push('quiescence:complete')
                    },
                },
            ),
        ).resolves.toBe(restoreMocks.ids.restore)

        expect(restoreMocks.getRun.mock.calls.map(([runId]) => runId)).toEqual([
            restoreMocks.ids.restore,
            restoreMocks.ids.source,
        ])
        expect(restoreMocks.restoreArchive).toHaveBeenCalledTimes(1)
        const restoreInput = restoreMocks.restoreArchive.mock.calls[0]?.[0]

        expect(Object.keys(restoreInput ?? {}).toSorted()).toEqual(
            [
                'filePath',
                'expectedChecksumSha256',
                'expectedIncludesStorage',
                'storageMutationBarrierHeld',
                'beforeRestoreMutation',
                'onProgress',
                'afterDatabaseRestore',
                'afterRestoreApplied',
            ].toSorted(),
        )
        expect(restoreInput).toMatchObject({
            filePath: 'C:\\Backups\\source.tanstack-backup.tar',
            expectedChecksumSha256: restoreMocks.checksumSha256,
            expectedIncludesStorage: true,
            storageMutationBarrierHeld: true,
        })
        expect(restoreMocks.exclusiveBarrier).toHaveBeenCalledTimes(1)
        expect(
            restoreMocks.getBackupFilePath.mock.calls.map(
                ([fileName]) => fileName,
            ),
        ).toEqual(['source.tanstack-backup.tar', 'source.tanstack-backup.tar'])
        expect(restoreMocks.getInitiatorSession).toHaveBeenCalledWith(
            'user-1',
            restoreMocks.initiatingSessionHash,
        )
        expect(restoreMocks.replaceAuthState).toHaveBeenCalledTimes(1)
        expect(restoreMocks.replaceAuthState).toHaveBeenCalledWith(
            restoreMocks.state.initiatorSession,
        )
        expect(restoreMocks.persistRun).toHaveBeenCalledTimes(2)
        expect(restoreMocks.persistRun.mock.calls[0]?.[0]).toBe(
            restoreMocks.state.sourceRun,
        )
        expect(restoreMocks.persistRun).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                id: restoreMocks.ids.restore,
                trigger: 'restore',
                status: 'completed',
                targetKey: 'local',
                includesStorage: true,
                fileName: null,
                checksumSha256: null,
                errorMessage: null,
                createdByUserId: null,
            }),
        )
        expect(restoreMocks.syncScheduler).toHaveBeenCalledTimes(1)
        expect(restoreMocks.publishReauthentication).toHaveBeenCalledTimes(2)
        expect(restoreMocks.publishReauthentication).toHaveBeenLastCalledWith({
            reason: 'restore',
            requestedAt: expect.any(String),
        })
        expect(restoreMocks.applyRetention).toHaveBeenCalledTimes(1)
        expect(restoreMocks.applyRetention.mock.calls[0]?.[0]).toEqual(
            new Set([restoreMocks.ids.source]),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({
                percent: 100,
                status: 'completed',
            }),
        )
        expect(restoreMocks.lifecycle).toEqual(
            expect.arrayContaining([
                'archive-complete',
                'quiescence:start',
                'marker:completed',
                'quiescence:complete',
            ]),
        )
        expect(restoreMocks.lifecycle.indexOf('archive-complete')).toBeLessThan(
            restoreMocks.lifecycle.indexOf('quiescence:start'),
        )
        expect(restoreMocks.lifecycle.indexOf('quiescence:start')).toBeLessThan(
            restoreMocks.lifecycle.indexOf('marker:completed'),
        )
        expect(restoreMocks.removeSessionBinding).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
        )
    })

    it('bindet das dauerhafte Journal an den ursprünglichen Actor und die geprüfte Quelle innerhalb der Barrier', async function () {
        restoreMocks.state.sourceRun.createdByUserId = 'source-only-user'
        restoreMocks.state.sourceRun.checksumSha256 =
            restoreMocks.checksumSha256.toUpperCase()
        restoreMocks.state.restoreRun.includesStorage = false
        await executeRestoreBackup(createRestoreJob(), {
            completeRestoreQuiescence: async function (publishCompletedState) {
                restoreMocks.lifecycle.push('quiescence:start')
                await publishCompletedState()
                restoreMocks.lifecycle.push('queues:resumed')
            },
        })

        expect(restoreMocks.createJournal).toHaveBeenCalledTimes(1)
        expect(restoreMocks.createJournal).toHaveBeenCalledWith({
            restoreRunId: restoreMocks.ids.restore,
            actorUserId: 'user-1',
            sourceBackupId: restoreMocks.ids.source,
            sourceChecksumSha256: restoreMocks.checksumSha256,
            includesStorage: true,
        })
        expect(restoreMocks.restoreArchive).toHaveBeenCalledWith(
            expect.objectContaining({ expectedIncludesStorage: true }),
        )
        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready', 'applied', 'completed'])
        expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
        const expectedOrder = [
            'barrier:entered',
            'actor-session:validated',
            'source:read',
            'journal:started',
            'archive:entered',
            'journal:rewind-ready',
            'archive:mutating',
            'auth:reconciled',
            `run:${restoreMocks.ids.restore}:completed`,
            'journal:applied',
            'archive:recovery-cleanup',
            'quiescence:start',
            'journal:completed',
            'marker:completed',
            'queues:resumed',
            'barrier:left',
            'journal:closed',
        ]
        for (const [index, entry] of expectedOrder.entries()) {
            expect(restoreMocks.lifecycle).toContain(entry)
            if (index > 0) {
                expect(
                    restoreMocks.lifecycle.indexOf(expectedOrder[index - 1]!),
                ).toBeLessThan(restoreMocks.lifecycle.indexOf(entry))
            }
        }
    })

    it.each([true, false])(
        'verweigert ohne ursprünglichen Actor auch bei vorhandener Valkey-Bindung=%s jedes Journal und Archiv',
        async function (hasSessionBinding) {
            restoreMocks.state.restoreRun.createdByUserId = null
            if (!hasSessionBinding) {
                restoreMocks.getSessionBinding.mockResolvedValueOnce(null)
            }

            await expect(
                executeRestoreBackup(createRestoreJob()),
            ).rejects.toThrow()

            expect(restoreMocks.createJournal).not.toHaveBeenCalled()
            expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
            expect(restoreMocks.journalClose).not.toHaveBeenCalled()
        },
    )

    it.each([
        { field: 'fileName', value: null },
        { field: 'status', value: 'failed' },
        { field: 'checksumSha256', value: null },
        { field: 'checksumSha256', value: 'invalid-checksum' },
    ])(
        'verweigert eine ungültige Quelle vor dem Journal: $field=$value',
        async function ({ field, value }) {
            restoreMocks.state.sourceRun[field] = value

            await expect(
                executeRestoreBackup(createRestoreJob()),
            ).rejects.toThrow()

            expect(restoreMocks.createJournal).not.toHaveBeenCalled()
            expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
            expect(restoreMocks.journalClose).not.toHaveBeenCalled()
        },
    )

    it('beginnt nach einem fehlgeschlagenen Journalstart keine Archivarbeit', async function () {
        const journalError = new Error('journal start unavailable')
        restoreMocks.createJournal.mockRejectedValueOnce(journalError)

        await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
            journalError,
        )

        expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        expect(restoreMocks.journalAppend).not.toHaveBeenCalled()
        expect(restoreMocks.journalClose).not.toHaveBeenCalled()
        expect(restoreMocks.replaceAuthState).not.toHaveBeenCalled()
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'failed' }),
        )
    })

    it('wartet auf rewind-ready, bevor es die Archivmutation freigibt', async function () {
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        restoreMocks.journalAppend.mockImplementationOnce(
            async function (phase) {
                expect(phase).toBe('rewind-ready')
                entered.resolve()
                await release.promise
            },
        )
        const running = executeRestoreBackup(createRestoreJob())
        void running.then(
            () =>
                entered.reject(
                    new Error('Restore finished without awaiting rewind-ready'),
                ),
            (error: unknown) => entered.reject(error),
        )

        await entered.promise
        try {
            expect(restoreMocks.lifecycle).not.toContain('archive:mutating')
            expect(restoreMocks.replaceAuthState).not.toHaveBeenCalled()
            expect(restoreMocks.journalClose).not.toHaveBeenCalled()
        } finally {
            release.resolve()
            await running
        }
        await expect(running).resolves.toBe(restoreMocks.ids.restore)
    })

    it('lässt bei fehlendem rewind-ready keine Restore-Mutation beginnen', async function () {
        const journalError = new Error('rewind-ready sync failed')
        restoreMocks.journalAppend.mockRejectedValueOnce(journalError)

        await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
            journalError,
        )

        expect(restoreMocks.lifecycle).not.toContain('archive:mutating')
        expect(restoreMocks.replaceAuthState).not.toHaveBeenCalled()
        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready'])
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'failed' }),
        )
        expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
    })

    it('hält nach einem applied-Journalfehler den Restore trotz zurückgekehrtem Archivfehler gesperrt', async function () {
        const journalError = new Error('applied sync failed')
        restoreMocks.journalAppend
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(journalError)

        await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
            journalError,
        )

        expect(restoreMocks.lifecycle).toContain('archive:mutating')
        expect(restoreMocks.lifecycle).not.toContain('archive:recovery-cleanup')
        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready', 'applied'])
        expect(restoreMocks.writeRestoreState).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' }),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
        expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
    })

    it('öffnet bei einem completed-Journalfehler weder den Marker noch die Queues', async function () {
        const journalError = new Error('completed sync failed')
        restoreMocks.journalAppend
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(journalError)
        const resumeQueues = vi.fn()

        await expect(
            executeRestoreBackup(createRestoreJob(), {
                completeRestoreQuiescence: async function (
                    publishCompletedState,
                ) {
                    await publishCompletedState()
                    resumeQueues()
                },
            }),
        ).rejects.toBe(journalError)

        expect(restoreMocks.lifecycle).toContain('archive-complete')
        expect(resumeQueues).not.toHaveBeenCalled()
        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready', 'applied', 'completed'])
        expect(restoreMocks.writeRestoreState).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' }),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
    })

    it.each(['failed', 'recovery-required'] as const)(
        'überschreibt bei nicht schreibbarer %s-Korrektur den Restorefehler nicht und speichert trotzdem den Status',
        async function (phase) {
            const restoreError =
                phase === 'failed'
                    ? new Error('source restore failed')
                    : new RestoreRollbackError(
                          'rollback failed',
                          [new Error('database rollback failed')],
                          new Error('source restore failed'),
                      )
            const journalError = new Error('failure journal sync failed')
            restoreMocks.restoreArchive.mockRejectedValueOnce(restoreError)
            restoreMocks.journalAppend.mockRejectedValueOnce(journalError)

            await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
                restoreError,
            )

            expect(restoreMocks.journalAppend).toHaveBeenCalledWith(phase)
            expect(restoreMocks.persistRun).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    id: restoreMocks.ids.restore,
                    status: 'failed',
                }),
            )
            expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: phase }),
            )
            expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
            expect(
                restoreMocks.logError.mock.calls.some(
                    ([, error]) => error === journalError,
                ),
            ).toBe(true)
        },
    )

    it.each([false, true])(
        'schreibt nach bestätigtem Rollback die Fehlerkorrektur und bleibt bei Journalfehler=%s entsprechend gesperrt',
        async function (journalFails) {
            const restoreError = new Error('restore failed after mutation')
            const journalError = new Error(
                'rollback result journal sync failed',
            )
            restoreMocks.restoreArchive.mockImplementationOnce(
                async function (input) {
                    await input.beforeRestoreMutation?.()
                    restoreMocks.lifecycle.push('archive:rollback-complete')
                    throw restoreError
                },
            )
            restoreMocks.journalAppend
                .mockResolvedValueOnce(undefined)
                .mockImplementationOnce(async function () {
                    restoreMocks.lifecycle.push('journal:failure-attempt')
                    if (journalFails) {
                        throw journalError
                    }
                })

            await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
                restoreError,
            )

            expect(
                restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
            ).toEqual(['rewind-ready', 'failed'])
            expect(
                restoreMocks.lifecycle.indexOf('archive:rollback-complete'),
            ).toBeLessThan(
                restoreMocks.lifecycle.indexOf('journal:failure-attempt'),
            )
            expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    status: journalFails ? 'recovery-required' : 'failed',
                }),
            )
            expect(restoreMocks.persistRun).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    id: restoreMocks.ids.restore,
                    status: 'failed',
                }),
            )
            expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
        },
    )

    it.each([
        'failure-correction',
        'close-after-success',
        'close-after-error',
    ] as const)(
        'erhält Ergebnis und Status auch bei einem defekten LogSink während %s',
        async function (failure) {
            const restoreError = new Error('original archive failure')
            const journalError = new Error('journal I/O failed')
            const logError = new Error('log sink failed')
            restoreMocks.logError.mockImplementationOnce(function () {
                throw logError
            })
            if (failure === 'failure-correction') {
                restoreMocks.restoreArchive.mockRejectedValueOnce(restoreError)
                restoreMocks.journalAppend.mockRejectedValueOnce(journalError)
            } else {
                restoreMocks.journalClose.mockRejectedValueOnce(journalError)
                if (failure === 'close-after-error') {
                    restoreMocks.restoreArchive.mockRejectedValueOnce(
                        restoreError,
                    )
                }
            }

            const running = executeRestoreBackup(createRestoreJob())
            if (failure === 'close-after-success') {
                await expect(running).resolves.toBe(restoreMocks.ids.restore)
            } else {
                await expect(running).rejects.toBe(restoreError)
            }

            expect(
                restoreMocks.logError.mock.calls.some(
                    ([, error]) => error === journalError,
                ),
            ).toBe(true)
            expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
            expect(restoreMocks.persistRun).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    id: restoreMocks.ids.restore,
                    status:
                        failure === 'close-after-success'
                            ? 'completed'
                            : 'failed',
                }),
            )
            expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    status:
                        failure === 'close-after-success'
                            ? 'completed'
                            : 'failed',
                }),
            )
        },
    )

    it('korrigiert das bereits abgeschlossene Journal bei einer späteren Barrier-Freigabestörung vor dem Close', async function () {
        const barrierError = new Error('barrier release failed')
        restoreMocks.exclusiveBarrier.mockImplementationOnce(
            async function (operation) {
                await operation()
                restoreMocks.lifecycle.push('barrier:release-failed')
                throw barrierError
            },
        )

        await expect(executeRestoreBackup(createRestoreJob())).rejects.toBe(
            barrierError,
        )

        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready', 'applied', 'completed', 'recovery-required'])
        expect(
            restoreMocks.lifecycle.indexOf('barrier:release-failed'),
        ).toBeLessThan(
            restoreMocks.lifecycle.indexOf('journal:recovery-required'),
        )
        expect(
            restoreMocks.lifecycle.indexOf('journal:recovery-required'),
        ).toBeLessThan(restoreMocks.lifecycle.indexOf('journal:closed'))
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
    })

    it.each([false, true])(
        'lässt einen Closefehler das Restore-Ergebnis (vorheriger Fehler=%s) nicht ändern',
        async function (restoreFails) {
            const closeError = new Error('journal handle close failed')
            const restoreError = new Error('archive failure')
            restoreMocks.journalClose.mockRejectedValueOnce(closeError)
            if (restoreFails) {
                restoreMocks.restoreArchive.mockRejectedValueOnce(restoreError)
            }

            const running = executeRestoreBackup(createRestoreJob())
            if (restoreFails) {
                await expect(running).rejects.toBe(restoreError)
            } else {
                await expect(running).resolves.toBe(restoreMocks.ids.restore)
            }

            expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
            expect(
                restoreMocks.logError.mock.calls.some(
                    ([, error]) => error === closeError,
                ),
            ).toBe(true)
        },
    )

    it('führt einen v2-Restore ohne Valkey-Bindung kompatibel mit vollständigem Logout aus', async function () {
        restoreMocks.getSessionBinding.mockResolvedValueOnce(null)

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).resolves.toBe(restoreMocks.ids.restore)

        expect(restoreMocks.getInitiatorSession).not.toHaveBeenCalled()
        expect(restoreMocks.replaceAuthState).toHaveBeenCalledWith(null)
    })

    it('bricht einen manipulierten Sitzungsbezug vor dem Archiv-Restore ab', async function () {
        const sessionBindingError = new Error(
            'Die Restore-Sitzung gehört einem fremden Benutzer.',
        )
        restoreMocks.getInitiatorSession.mockRejectedValueOnce(
            sessionBindingError,
        )

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toBe(sessionBindingError)

        expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        expect(restoreMocks.replaceAuthState).not.toHaveBeenCalled()
        expect(restoreMocks.persistRun).toHaveBeenCalledWith(
            expect.objectContaining({
                id: restoreMocks.ids.restore,
                status: 'failed',
            }),
        )
    })

    it('lehnt einen bereits laufenden Restore vor Marker und Archiv strikt ab', async function () {
        restoreMocks.state.restoreRun.status = 'running'

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toThrow('nicht in einem ausführbaren Zustand')

        expect(restoreMocks.database.update).not.toHaveBeenCalled()
        expect(restoreMocks.writeRestoreState).toHaveBeenCalledTimes(1)
        expect(restoreMocks.writeRestoreState).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
        expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        expect(restoreMocks.exclusiveBarrier).not.toHaveBeenCalled()
    })

    it.each(['missing', 'size-mismatch'] as const)(
        'überspringt einen inkonsistenten fremden Completed-Run (%s), ohne den Restore der gültigen Source abzubrechen',
        async function (failureKind) {
            const inconsistentRun = {
                ...restoreMocks.state.sourceRun,
                id: '019f5b07-80e2-7000-8000-000000000099',
                fileName: 'inconsistent.tanstack-backup.tar',
                fileSize: 2_048,
            }
            restoreMocks.state.fileRuns = [
                restoreMocks.state.sourceRun,
                inconsistentRun,
            ]
            restoreMocks.statFile.mockImplementation(async function (
                filePath: string,
            ) {
                if (filePath.includes('inconsistent')) {
                    if (failureKind === 'missing') {
                        throw Object.assign(new Error('backup file missing'), {
                            code: 'ENOENT',
                        })
                    }

                    return {
                        isFile: function () {
                            return true as const
                        },
                        size: 1_024,
                    }
                }

                return {
                    isFile: function () {
                        return true as const
                    },
                    size: restoreMocks.state.sourceRun.fileSize,
                }
            })

            await expect(
                executeRestoreBackup({
                    contractVersion: 2,
                    kind: 'restore',
                    runId: restoreMocks.ids.restore,
                    sourceBackupId: restoreMocks.ids.source,
                }),
            ).resolves.toBe(restoreMocks.ids.restore)

            expect(restoreMocks.restoreArchive).toHaveBeenCalledTimes(1)
            expect(restoreMocks.persistRun).not.toHaveBeenCalledWith(
                inconsistentRun,
            )
            expect(restoreMocks.logError).toHaveBeenCalledWith(
                'backup.restore.catalog_entry_skipped',
                expect.any(Error),
                { runId: inconsistentRun.id },
            )
        },
    )

    it('setzt einen laufenden Marker bei einem Barrier-Acquire-Fehler fail-closed auf recovery-required', async function () {
        const barrierError = new Error('Exclusive Lock nicht verfügbar')
        restoreMocks.exclusiveBarrier.mockRejectedValueOnce(barrierError)

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toBe(barrierError)

        expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        expect(restoreMocks.writeRestoreState).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ status: 'running' }),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
    })

    it('überschreibt completed fail-closed, wenn die Barrier-Verbindung nach dem Restore nicht sicher geschlossen wird', async function () {
        const discardError = new Error('reserved connection close failed')
        restoreMocks.exclusiveBarrier.mockImplementationOnce(
            async function (operation) {
                await operation()
                throw discardError
            },
        )

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toBe(discardError)

        expect(restoreMocks.writeRestoreState).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' }),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({
                phase: 'finalizing',
                status: 'recovery-required',
            }),
        )
    })

    it('zeigt completed nicht an, wenn der Quiesce nach angewendetem Restore fehlschlägt', async function () {
        const quiescenceError = new Error('Mail-Purge fehlgeschlagen')

        await expect(
            executeRestoreBackup(
                {
                    contractVersion: 2,
                    kind: 'restore',
                    runId: restoreMocks.ids.restore,
                    sourceBackupId: restoreMocks.ids.source,
                },
                {
                    completeRestoreQuiescence: async function () {
                        throw quiescenceError
                    },
                },
            ),
        ).rejects.toBe(quiescenceError)

        expect(
            restoreMocks.journalAppend.mock.calls.map(([phase]) => phase),
        ).toEqual(['rewind-ready', 'applied', 'recovery-required'])
        expect(restoreMocks.journalClose).toHaveBeenCalledTimes(1)
        expect(restoreMocks.lifecycle).toContain('archive-complete')
        expect(restoreMocks.writeRestoreState).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' }),
        )
        expect(restoreMocks.writeRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({
                phase: 'finalizing',
                status: 'recovery-required',
            }),
        )
    })

    it('persistiert einen Source-Fehler als failed und versucht den Restore nicht erneut', async function () {
        const restoreError = new Error('Source-Restore fehlgeschlagen')
        restoreMocks.restoreArchive.mockRejectedValueOnce(restoreError)

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toBe(restoreError)

        expect(restoreMocks.restoreArchive).toHaveBeenCalledTimes(1)
        expect(restoreMocks.persistRun).toHaveBeenCalledTimes(2)
        expect(restoreMocks.persistRun.mock.calls[0]?.[0]).toBe(
            restoreMocks.state.sourceRun,
        )
        expect(restoreMocks.persistRun).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                id: restoreMocks.ids.restore,
                status: 'failed',
                errorMessage: 'Der Backup-Vorgang ist fehlgeschlagen.',
                includesStorage: true,
                createdByUserId: null,
            }),
        )
        expect(restoreMocks.applyRetention).not.toHaveBeenCalled()
        expect(restoreMocks.syncScheduler).not.toHaveBeenCalled()
        expect(restoreMocks.publishReauthentication).toHaveBeenCalledTimes(1)
    })

    it('hält den globalen Restore-Zustand bei einem Rollbackfehler auf recovery-required', async function () {
        const rollbackError = new RestoreRollbackError(
            'Restore und automatischer Rollback sind fehlgeschlagen.',
            [new Error('storage rollback failed')],
            new Error('restore failed'),
        )
        restoreMocks.restoreArchive.mockRejectedValueOnce(rollbackError)

        await expect(
            executeRestoreBackup({
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            }),
        ).rejects.toBe(rollbackError)

        expect(restoreMocks.writeRestoreState).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
        expect(restoreMocks.writeRestoreState).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed' }),
        )
        expect(restoreMocks.publishRestoreState).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
        expect(restoreMocks.persistRun).toHaveBeenLastCalledWith(
            expect.objectContaining({
                id: restoreMocks.ids.restore,
                status: 'failed',
            }),
        )
    })

    it('plant den Restore-Job explizit ohne automatischen Retry ein', async function () {
        useEnqueueTransaction()

        await expect(
            enqueueRestoreBackupService(
                restoreMocks.ids.source,
                'user-1',
                restoreMocks.initiatingSessionHash,
                restoreMocks.state.initiatorSession.expiresAt,
            ),
        ).resolves.toEqual({
            success: true,
            runId: restoreMocks.ids.restore,
        })

        expect(restoreMocks.queueAdd).toHaveBeenCalledWith(
            'restore-backup',
            {
                contractVersion: 2,
                kind: 'restore',
                runId: restoreMocks.ids.restore,
                sourceBackupId: restoreMocks.ids.source,
            },
            { attempts: 1, jobId: restoreMocks.ids.restore },
        )
        expect(restoreMocks.saveSessionBinding).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
            restoreMocks.initiatingSessionHash,
            restoreMocks.state.initiatorSession.expiresAt,
        )
        expect(restoreMocks.markQueueFailed).not.toHaveBeenCalled()
        expect(restoreMocks.lifecycle.indexOf('binding:saved')).toBeLessThan(
            restoreMocks.lifecycle.indexOf('queue:added'),
        )
    })

    it('plant ohne sichere Sitzungsbindung keinen Restore-Job ein', async function () {
        const bindingError = new Error('Valkey-Bindung fehlgeschlagen')
        useEnqueueTransaction()
        restoreMocks.saveSessionBinding.mockRejectedValueOnce(bindingError)

        await expect(
            enqueueRestoreBackupService(
                restoreMocks.ids.source,
                'user-1',
                restoreMocks.initiatingSessionHash,
                restoreMocks.state.initiatorSession.expiresAt,
            ),
        ).rejects.toBe(bindingError)

        expect(restoreMocks.queueAdd).not.toHaveBeenCalled()
        expect(restoreMocks.removeSessionBinding).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
        )
        expect(restoreMocks.markQueueFailed).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
            bindingError,
            'user-1',
        )
    })

    it('räumt die Sitzungsbindung auf, wenn das Queueing fehlschlägt', async function () {
        const queueError = new Error('Queue nicht verfügbar')
        useEnqueueTransaction()
        restoreMocks.queueAdd.mockRejectedValueOnce(queueError)

        await expect(
            enqueueRestoreBackupService(
                restoreMocks.ids.source,
                'user-1',
                restoreMocks.initiatingSessionHash,
                restoreMocks.state.initiatorSession.expiresAt,
            ),
        ).rejects.toBe(queueError)

        expect(restoreMocks.saveSessionBinding).toHaveBeenCalledTimes(1)
        expect(restoreMocks.removeSessionBinding).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
        )
        expect(restoreMocks.markQueueFailed).toHaveBeenCalledWith(
            restoreMocks.ids.restore,
            queueError,
            'user-1',
        )
    })

    it.each(['audit', 'commit'])(
        'bindet und dispatcht nach %s-Fehler keinen Restore',
        async function (failure) {
            useEnqueueTransaction()
            auditMocks.state.failAction =
                failure === 'audit' ? 'admin.backups.restore_queued' : null
            auditMocks.state.failCommit = failure === 'commit'

            await expect(
                enqueueRestoreBackupService(
                    restoreMocks.ids.source,
                    'user-1',
                    restoreMocks.initiatingSessionHash,
                    restoreMocks.state.initiatorSession.expiresAt,
                ),
            ).rejects.toThrow()

            expect(restoreMocks.state.createdRuns).toEqual([])
            expect(auditMocks.state.records).toEqual([])
            expect(restoreMocks.saveSessionBinding).not.toHaveBeenCalled()
            expect(restoreMocks.queueAdd).not.toHaveBeenCalled()
            expect(restoreMocks.markQueueFailed).not.toHaveBeenCalled()
            expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        },
    )

    it('committet Actor und Restore-Audit vor Valkey-Bindung und Queue', async function () {
        useEnqueueTransaction()

        await enqueueRestoreBackupService(
            restoreMocks.ids.source,
            'user-1',
            restoreMocks.initiatingSessionHash,
            restoreMocks.state.initiatorSession.expiresAt,
        )

        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({
                action: 'admin.backups.restore_queued',
                actorUserId: 'user-1',
                newValues: {
                    backupId: restoreMocks.ids.source,
                    restoreRunId: restoreMocks.ids.restore,
                },
            }),
        ])
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'restore-advisory-lock',
            'source-lock',
            'run-insert',
            'audit:admin.backups.restore_queued',
            'commit',
            'publish-audit',
            'binding',
            'queue',
        ])
    })

    it('lehnt eine unverifizierte Quelle weiterhin vor Run und Audit ab', async function () {
        useEnqueueTransaction()
        restoreMocks.state.sourceRun.checksumSha256 = null

        await expect(
            enqueueRestoreBackupService(
                restoreMocks.ids.source,
                'user-1',
                restoreMocks.initiatingSessionHash,
                restoreMocks.state.initiatorSession.expiresAt,
            ),
        ).rejects.toThrow('nicht vollständig verifiziert')

        expect(restoreMocks.state.createdRuns).toEqual([])
        expect(auditMocks.write).not.toHaveBeenCalled()
        expect(restoreMocks.saveSessionBinding).not.toHaveBeenCalled()
        expect(restoreMocks.queueAdd).not.toHaveBeenCalled()
    })

    it.each(backupMutationRevocations)(
        'nimmt nach Actor-Widerruf vor dem Lock keinen Restore an: %s',
        async function (revocation) {
            mutationMocks.revokeAtLock(revocation)
            useEnqueueTransaction()
            await expect(
                enqueueRestoreBackupService(
                    restoreMocks.ids.source,
                    'actor-policy',
                    restoreMocks.initiatingSessionHash,
                    new Date(Date.now() + 60_000),
                ),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(restoreMocks.state.createdRuns).toEqual([])
            expect(auditMocks.state.records).toEqual([])
            expect(auditMocks.publish).not.toHaveBeenCalled()
            expect(restoreMocks.saveSessionBinding).not.toHaveBeenCalled()
            expect(restoreMocks.queueAdd).not.toHaveBeenCalled()
            expect(restoreMocks.restoreArchive).not.toHaveBeenCalled()
        },
    )

    it('führt einen bereits angenommenen Restore nach späterem Rechteentzug aus', async function () {
        useEnqueueTransaction()
        await enqueueRestoreBackupService(
            restoreMocks.ids.source,
            'actor-policy',
            restoreMocks.initiatingSessionHash,
            new Date(Date.now() + 60_000),
        )
        mutationMocks.state.permissionKeys = []
        mutationMocks.state.isActive = false
        mutationMocks.selectPolicy.mockClear()
        await expect(executeRestoreBackup(createRestoreJob())).resolves.toBe(
            restoreMocks.ids.restore,
        )
        expect(restoreMocks.restoreArchive).toHaveBeenCalledTimes(1)
        expect(mutationMocks.selectPolicy).not.toHaveBeenCalled()
    })
})
