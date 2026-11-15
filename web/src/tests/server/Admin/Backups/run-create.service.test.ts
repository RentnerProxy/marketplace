import { getOrCreateBackupSettings } from '@/server/Admin/Backups/settings.service.ts'
import {
    createBackupMutationMocks,
    backupMutationRevocations,
} from './backupMutationTestUtils.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import {
    createBackupAuditMocks,
    matchesBackupRunCondition,
} from './backupAuditTestUtils.ts'
import { rm } from 'node:fs/promises'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createBackupArchive } from '@/server/Admin/Backups/archive-create.service.ts'
import {
    createManualBackupForDownloadService,
    registerImportedBackupService,
} from '@/server/Admin/Backups/run-create.service.ts'
import { applyBackupRetentionBestEffort } from '@/server/Admin/Backups/run-retention.service.ts'
import {
    processBackupJob,
    reconcileFailedBackupJob,
} from '@/server/Admin/Backups/run-job.service.ts'

const auditMocks = createBackupAuditMocks()
const publishChanged = vi.fn()
vi.mock('@/server/Realtime/publish.service.ts', function () {
    return { publishAdminBackupsChangedService: publishChanged }
})
const mutationMocks = createBackupMutationMocks(auditMocks)

const schemaMock = (function () {
    return {
        ...mutationMocks.schema,
        backupRuns: {
            id: 'backupRuns.id',
            status: 'backupRuns.status',
        },
    }
})()

const backupMocks = (function () {
    const initialRun = {
        id: '019f5b07-80e2-7000-8000-000000000001',
        status: 'queued',
        createdByUserId: 'user-1',
        includesStorage: false,
        startedAt: null as Date | null,
        completedAt: null as Date | null,
        errorMessage: null as string | null,
        fileName: null as string | null,
        fileSize: null as number | null,
        checksumSha256: null as string | null,
    }
    const state = {
        pendingUpdate: {} as Record<string, unknown>,
        createdRuns: [] as Array<Record<string, unknown>>,
        didUpdate: false,
        run: { ...initialRun },
    }
    const returning = vi.fn(async function () {
        return state.didUpdate ? [{ id: state.run.id }] : []
    })
    const where = vi.fn(function (condition: unknown) {
        state.didUpdate = matchesBackupRunCondition(state.run, condition)
        if (state.didUpdate) Object.assign(state.run, state.pendingUpdate)
        return { returning }
    })
    const set = vi.fn(function (values: Record<string, unknown>) {
        state.pendingUpdate = values
        return { where }
    })
    const tx = {
        select: vi.fn(function (projection: unknown) {
            return mutationMocks.selectPolicy(tx, projection)
        }),
        update: vi.fn(function () {
            return { set }
        }),
    }

    const database = {
        ...tx,
        select: vi.fn(function () {
            throw new Error('Unexpected global policy read')
        }),
        transaction: vi.fn(async function <Result>(
            operation: (transaction: typeof tx) => Result | Promise<Result>,
        ) {
            const previousRun = structuredClone(state.run)
            const previousCreated = structuredClone(state.createdRuns)
            return auditMocks.transaction(tx, operation, function () {
                state.run = previousRun
                state.createdRuns = previousCreated
            })
        }),
    }

    return {
        createArchive: vi.fn(),
        createRun: vi.fn(async function (
            input: Record<string, unknown>,
            executor?: unknown,
        ) {
            if (executor !== undefined && executor !== tx)
                throw new Error('Run insert escaped the transaction')
            auditMocks.state.events.push('run-insert')
            state.createdRuns.push(structuredClone(input))
            return state.run.id
        }),
        database,
        tx,
        getRun: vi.fn(async function () {
            return { ...state.run }
        }),
        initialRun,
        markQueueFailed: vi.fn(async function (_runId, error: unknown) {
            state.run.status = 'failed'
            state.run.completedAt = new Date()
            state.run.errorMessage =
                error instanceof Error ? error.message : String(error)
        }),
        queueAdd: vi.fn(),
        returning,
        set,
        state,
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
    return { db: backupMocks.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
        inArray: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'inArray', left, right }
        }),
    }
})

vi.mock('node:fs/promises', function () {
    return { rm: vi.fn(async function () {}) }
})

vi.mock('@/server/Admin/Backups/archive-create.service.ts', function () {
    return { createBackupArchive: backupMocks.createArchive }
})

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    const schema = {
        parse: vi.fn(function (data: unknown) {
            return data
        }),
        safeParse: vi.fn(function (data: unknown) {
            return { success: true, data }
        }),
    }

    return {
        backupFailureJobDataSchema: schema,
        backupJobDataSchema: schema,
        getBackupQueue: vi.fn(function () {
            return { add: backupMocks.queueAdd }
        }),
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return {
        createRun: backupMocks.createRun,
        getBackupRunById: backupMocks.getRun,
        markRunAsQueueFailed: backupMocks.markQueueFailed,
    }
})

vi.mock('@/server/Admin/Backups/run-restore.service.ts', function () {
    return { executeRestoreBackup: vi.fn() }
})

vi.mock('@/server/Admin/Backups/run-retention.service.ts', function () {
    return { applyBackupRetentionBestEffort: vi.fn(async function () {}) }
})

vi.mock('@/server/Admin/Backups/settings.service.ts', function () {
    return {
        getOrCreateBackupSettings: vi.fn(async function () {
            return {}
        }),
        serializeBackupSettings: vi.fn(function () {
            return { includeStorage: false }
        }),
    }
})

vi.mock('@/server/Admin/Backups/backup-directory.service.ts', function () {
    return { getBackupFilePath: vi.fn() }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

const createJob = {
    kind: 'create' as const,
    runId: '019f5b07-80e2-7000-8000-000000000001',
    trigger: 'manual' as const,
}

const mockedCreateBackupArchive = createBackupArchive as Mock<
    typeof createBackupArchive
>

describe('Backup-Create-Retry-Status', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        mutationMocks.reset()
        backupMocks.state.createdRuns = []
        backupMocks.state.didUpdate = false
        backupMocks.state.pendingUpdate = {}
        backupMocks.state.run = { ...backupMocks.initialRun }
        backupMocks.queueAdd.mockResolvedValue({ id: createJob.runId })
    })

    it('bestätigt den seriellen Queue-Job sofort ohne Archiv-Ausführung oder Completion-Wait', async function () {
        await expect(
            createManualBackupForDownloadService('user-1'),
        ).resolves.toEqual({
            success: true,
            runId: createJob.runId,
        })
        expect(backupMocks.queueAdd).toHaveBeenCalledWith(
            'manual-backup',
            createJob,
            { jobId: createJob.runId },
        )
        expect(mockedCreateBackupArchive).not.toHaveBeenCalled()
        expect(backupMocks.state.run.status).toBe('queued')
    })

    it('lässt den Run nach einem Zwischenfehler für den nächsten Versuch ausführbar', async function () {
        const firstError = new Error('temporärer Archivfehler')
        mockedCreateBackupArchive
            .mockRejectedValueOnce(firstError)
            .mockResolvedValueOnce({
                fileName: 'backup.tar',
                fileSize: 42,
                checksumSha256: 'a'.repeat(64),
            })

        await expect(processBackupJob(createJob)).rejects.toBe(firstError)
        expect(backupMocks.state.run).toMatchObject({
            status: 'queued',
            completedAt: null,
            errorMessage: 'Der Backup-Vorgang ist fehlgeschlagen.',
        })

        await expect(processBackupJob(createJob)).resolves.toBe(createJob.runId)
        expect(backupMocks.state.run).toMatchObject({
            status: 'completed',
            completedAt: expect.any(Date),
            fileName: 'backup.tar',
        })
        expect(createBackupArchive).toHaveBeenCalledTimes(2)
        expect(createBackupArchive).toHaveBeenNthCalledWith(1, {
            includesStorage: false,
        })
        expect(createBackupArchive).toHaveBeenNthCalledWith(2, {
            includesStorage: false,
        })
        expect(applyBackupRetentionBestEffort).toHaveBeenCalledWith()
    })

    it('registriert und auditiert Importe vor Dateiveröffentlichung in derselben TX', async function () {
        const publishArchive = vi.fn(async function () {
            auditMocks.state.events.push('publish-file')
        })
        await expect(
            registerImportedBackupService(
                {
                    userId: 'user-1',
                    fileName: 'import.tar',
                    fileSize: 42,
                    checksumSha256: 'a'.repeat(64),
                    includesStorage: true,
                },
                publishArchive,
            ),
        ).resolves.toEqual({
            runId: createJob.runId,
            auditReceipt: auditMocks.receipt,
        })

        expect(backupMocks.createRun).toHaveBeenCalledWith(
            {
                trigger: 'import',
                includesStorage: true,
                createdByUserId: 'user-1',
                fileName: 'import.tar',
                fileSize: 42,
                checksumSha256: 'a'.repeat(64),
                status: 'completed',
            },
            backupMocks.tx,
        )
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'run-insert',
            'audit:admin.backups.imported',
            'publish-file',
            'commit',
        ])
        expect(publishArchive).toHaveBeenCalledTimes(1)
        expect(publishChanged).toHaveBeenCalledTimes(1)
        expect(publishChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
            publishArchive.mock.invocationCallOrder[0],
        )
        expect(applyBackupRetentionBestEffort).not.toHaveBeenCalled()
        expect(auditMocks.publish).not.toHaveBeenCalled()
    })

    it('übernimmt einen bereits als failed persistierten Zwischenzustand', async function () {
        backupMocks.state.run.status = 'failed'
        backupMocks.state.run.completedAt = new Date('2026-01-01T12:00:00.000Z')
        backupMocks.state.run.errorMessage = 'alter Zwischenfehler'
        mockedCreateBackupArchive.mockResolvedValue({
            fileName: 'backup.tar',
            fileSize: 42,
            checksumSha256: 'a'.repeat(64),
        })

        await expect(processBackupJob(createJob)).resolves.toBe(createJob.runId)

        expect(backupMocks.set).toHaveBeenNthCalledWith(1, {
            status: 'running',
            startedAt: expect.any(Date),
            completedAt: null,
            errorMessage: null,
        })
        expect(backupMocks.state.run.status).toBe('completed')
    })

    it('reicht den optionalen Worker-Fortschritt bis zur Archiv-Erstellung durch', async function () {
        const reportProgress = vi.fn()
        mockedCreateBackupArchive.mockImplementationOnce(
            async function (input) {
                await input.onProgress?.({
                    version: 1,
                    phase: 'archiving',
                    processedBytes: 25,
                    totalBytes: 100,
                })
                return {
                    fileName: 'backup.tar',
                    fileSize: 42,
                    checksumSha256: 'a'.repeat(64),
                }
            },
        )

        await expect(
            processBackupJob(createJob, { reportProgress }),
        ).resolves.toBe(createJob.runId)

        expect(reportProgress).toHaveBeenCalledWith({
            version: 1,
            phase: 'archiving',
            processedBytes: 25,
            totalBytes: 100,
        })
    })

    it('markiert erst die finale Queue-Niederlage als failed', async function () {
        const finalError = new Error('finaler Archivfehler')
        mockedCreateBackupArchive.mockRejectedValue(finalError)

        await expect(processBackupJob(createJob)).rejects.toBe(finalError)
        expect(backupMocks.state.run.status).toBe('queued')

        await reconcileFailedBackupJob(createJob, finalError)

        expect(backupMocks.markQueueFailed).toHaveBeenCalledWith(
            createJob.runId,
            finalError,
        )
        expect(backupMocks.state.run.status).toBe('failed')
    })

    it.each(['audit', 'commit'])(
        'dispatcht ohne erfolgreichen %s keinen manuellen Job',
        async function (failure) {
            auditMocks.state.failAction =
                failure === 'audit' ? 'admin.backups.creation_queued' : null
            auditMocks.state.failCommit = failure === 'commit'

            await expect(
                createManualBackupForDownloadService('user-1'),
            ).rejects.toThrow()

            expect(backupMocks.state.createdRuns).toEqual([])
            expect(auditMocks.state.records).toEqual([])
            expect(backupMocks.queueAdd).not.toHaveBeenCalled()
            expect(backupMocks.createArchive).not.toHaveBeenCalled()
            expect(backupMocks.markQueueFailed).not.toHaveBeenCalled()
        },
    )

    it('gibt einen manuellen Run erst mit dauerhaftem Actor-Audit an die Queue', async function () {
        backupMocks.queueAdd.mockImplementationOnce(async function () {
            expect(auditMocks.state.records).toHaveLength(1)
            expect(auditMocks.state.events).toContain('commit')
            auditMocks.state.events.push('queue')
            return { id: createJob.runId }
        })

        await createManualBackupForDownloadService('user-1')

        expect(auditMocks.state.records[0]).toMatchObject({
            action: 'admin.backups.creation_queued',
            actorUserId: 'user-1',
            route: '/api/admin/backups/download',
            method: 'POST',
        })
        expect(auditMocks.state.events.indexOf('actor-lock')).toBeLessThan(
            auditMocks.state.events.indexOf('run-insert'),
        )
        expect(auditMocks.state.events.indexOf('commit')).toBeLessThan(
            auditMocks.state.events.indexOf('queue'),
        )
    })

    it('dispatcht bei fehlgeschlagener Audit-Veröffentlichung keinen manuellen Job', async function () {
        auditMocks.state.failPublish = true
        await expect(
            createManualBackupForDownloadService('user-1'),
        ).rejects.toThrow('publication failed')
        expect(backupMocks.state.createdRuns).toHaveLength(1)
        expect(auditMocks.state.records).toHaveLength(1)
        expect(backupMocks.queueAdd).not.toHaveBeenCalled()
        expect(mockedCreateBackupArchive).not.toHaveBeenCalled()
    })

    it('bewahrt das Run-Audit und fordert bei Queuefehler die bestehende Kompensation an', async function () {
        const error = new Error('synthetic queue failed')
        backupMocks.queueAdd.mockRejectedValueOnce(error)

        await expect(
            createManualBackupForDownloadService('user-1'),
        ).rejects.toBe(error)

        expect(backupMocks.state.createdRuns).toHaveLength(1)
        expect(auditMocks.state.records).toHaveLength(1)
        expect(backupMocks.markQueueFailed).toHaveBeenCalledWith(
            createJob.runId,
            error,
            'user-1',
        )
    })

    it('veröffentlicht bei Import-Auditfehler keine Datei und keinen Run', async function () {
        const publishArchive = vi.fn(async function () {})
        auditMocks.state.failAction = 'admin.backups.imported'

        await expect(
            registerImportedBackupService(
                {
                    userId: 'user-1',
                    fileName: 'import.tar',
                    fileSize: 42,
                    checksumSha256: 'a'.repeat(64),
                    includesStorage: false,
                },
                publishArchive,
            ),
        ).rejects.toThrow('audit insert')

        expect(publishArchive).not.toHaveBeenCalled()
        expect(backupMocks.state.createdRuns).toEqual([])
        expect(auditMocks.state.records).toEqual([])
    })

    it('rollt Import-Run und Audit bei fehlgeschlagener Dateiveröffentlichung zurück', async function () {
        const publishArchive = vi.fn(async function () {
            throw new Error('synthetic rename failed')
        })

        await expect(
            registerImportedBackupService(
                {
                    userId: 'user-1',
                    fileName: 'import.tar',
                    fileSize: 42,
                    checksumSha256: 'a'.repeat(64),
                    includesStorage: false,
                },
                publishArchive,
            ),
        ).rejects.toThrow('rename failed')

        expect(publishArchive).toHaveBeenCalledTimes(1)
        expect(backupMocks.state.createdRuns).toEqual([])
        expect(auditMocks.state.records).toEqual([])
    })

    it('rollt completed bei Auditfehler zurück und entfernt nur das neue Archiv', async function () {
        mockedCreateBackupArchive.mockResolvedValueOnce({
            fileName: 'backup.tar',
            fileSize: 42,
            checksumSha256: 'a'.repeat(64),
        })
        auditMocks.state.failAction = 'admin.backups.created'

        await expect(processBackupJob(createJob)).rejects.toThrow(
            'audit insert',
        )

        expect(backupMocks.state.run).toMatchObject({
            status: 'queued',
            fileName: null,
            checksumSha256: null,
        })
        expect(auditMocks.state.records).toEqual([])
        expect(rm).toHaveBeenCalledTimes(1)
        expect(applyBackupRetentionBestEffort).not.toHaveBeenCalled()
        expect(auditMocks.publish).not.toHaveBeenCalled()
    })

    it('löscht nach committed completed auch bei Publishfehler kein bestätigtes Archiv', async function () {
        mockedCreateBackupArchive.mockResolvedValueOnce({
            fileName: 'backup.tar',
            fileSize: 42,
            checksumSha256: 'a'.repeat(64),
        })
        auditMocks.state.failPublish = true

        await expect(processBackupJob(createJob)).rejects.toThrow(
            'publication failed',
        )

        expect(backupMocks.state.run).toMatchObject({
            status: 'completed',
            fileName: 'backup.tar',
        })
        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({
                action: 'admin.backups.created',
                actorUserId: 'user-1',
                route: null,
                method: 'WORKER',
            }),
        ])
        expect(rm).not.toHaveBeenCalled()
    })

    it.each(backupMutationRevocations)(
        'verhindert manuelle Annahme bei Actor-Widerruf vor dem Lock: %s',
        async function (revocation) {
            mutationMocks.revokeAtLock(revocation)
            await expect(
                createManualBackupForDownloadService('actor-policy'),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(getOrCreateBackupSettings).not.toHaveBeenCalled()
            expect(backupMocks.createRun).not.toHaveBeenCalled()
            expect(backupMocks.queueAdd).not.toHaveBeenCalled()
            expect(backupMocks.state.createdRuns).toEqual([])
            expect(auditMocks.state.records).toEqual([])
            expect(auditMocks.publish).not.toHaveBeenCalled()
        },
    )

    it.each(backupMutationRevocations)(
        'publiziert keinen Import bei Actor-Widerruf vor dem Lock: %s',
        async function (revocation) {
            mutationMocks.revokeAtLock(revocation)
            const publish = vi.fn(async function () {})
            await expect(
                registerImportedBackupService(
                    {
                        userId: 'actor-policy',
                        fileName: 'synthetic-actor-import.tdbak',
                        fileSize: 80,
                        checksumSha256: 'a'.repeat(64),
                        includesStorage: false,
                    },
                    publish,
                ),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(publish).not.toHaveBeenCalled()
            expect(backupMocks.createRun).not.toHaveBeenCalled()
            expect(backupMocks.state.createdRuns).toEqual([])
            expect(auditMocks.state.records).toEqual([])
        },
    )

    it('initialisiert manuelle Settings erst nach dem Lock mit derselben Transaktion', async function () {
        const lockReached = Promise.withResolvers<void>()
        const releaseLock = Promise.withResolvers<void>()
        mutationMocks.state.beforeLock = async function () {
            lockReached.resolve()
            await releaseLock.promise
        }
        const running = createManualBackupForDownloadService('actor-policy')
        await lockReached.promise
        expect(getOrCreateBackupSettings).not.toHaveBeenCalled()
        expect(backupMocks.createRun).not.toHaveBeenCalled()
        releaseLock.resolve()
        await running
        expect(getOrCreateBackupSettings).toHaveBeenCalledWith(backupMocks.tx)
        expect(mutationMocks.selectPolicy).toHaveBeenCalledTimes(2)
    })

    it('führt ein bereits angenommenes manuelles Backup nach späterem Rechteentzug aus', async function () {
        await createManualBackupForDownloadService('actor-policy')
        mutationMocks.state.permissionKeys = []
        mutationMocks.state.isActive = false
        mutationMocks.selectPolicy.mockClear()
        mockedCreateBackupArchive.mockResolvedValueOnce({
            fileName: 'synthetic-accepted.tdbak',
            fileSize: 80,
            checksumSha256: 'a'.repeat(64),
        })
        await expect(processBackupJob(createJob)).resolves.toBe(createJob.runId)
        expect(mockedCreateBackupArchive).toHaveBeenCalledTimes(1)
        expect(mutationMocks.selectPolicy).not.toHaveBeenCalled()
        expect(applyBackupRetentionBestEffort).toHaveBeenCalledTimes(1)
    })
})
