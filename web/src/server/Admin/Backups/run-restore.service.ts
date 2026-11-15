import type { BackupJobData } from '@/server/Admin/Backups/Types/backup-job.types.ts'
import { RestoreRollbackError } from './archive-restore.errors.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { BackupRunRecord } from './Types/run-restore.types.ts'
import { assertExpectedChecksum } from './archive-validation.service.ts'
import { createRestoreJournalService } from './restore-journal.service.ts'
import type { RestoreJournal } from './Types/restore-journal.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { stat } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { normalizeError } from '@/lib/Errors/error.ts'
import { db } from '@/db'
import { BACKUP_TARGET_KEY } from '@/config/backup.config.ts'
import { backupRuns } from '@/db/schema.ts'
import { logError } from '@/server/Logging/logger.ts'
import {
    publishRealtimeReauthenticationRequiredService,
    publishSystemRestoreChangedService,
} from '@/server/Realtime/publish.service.ts'
import type { BackupRestoreProgress } from '@/lib/Backups/Types/backup.types.ts'
import { restoreBackupArchive } from './archive-restore.service.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { getBackupQueue, syncBackupScheduler } from './backup.queue.ts'

import {
    getOrCreateBackupSettings,
    serializeBackupSettings,
} from './settings.service.ts'
import { BACKUP_FAILURE_MESSAGE } from './error.service.ts'
import {
    getBackupRunById,
    markRunAsQueueFailed,
    persistBackupRunAfterRestore,
} from './run-registry.service.ts'
import { applyBackupRetentionBestEffort } from './run-retention.service.ts'
import {
    getRestoreStateService,
    getRestoreStateFromProgress,
    writeRestoreStateService,
} from './restore-state.service.ts'
import { withExclusiveStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import type {
    BackupJobExecutionOptions,
    BackupProgressReporter,
} from './backup-service.types.ts'
import {
    consumeRestoreInitiatorSessionBindingService,
    deleteRestoreInitiatorSessionBindingBestEffortService,
    getRestoreInitiatorSessionService,
    replaceRestoredAuthenticationStateService,
    saveRestoreInitiatorSessionBindingService,
} from './restore-session.service.ts'

function logRestoreJournalFailureBestEffort(event: string, error: unknown) {
    try {
        logError(event, error)
    } catch {}
}

export async function enqueueRestoreBackupService(
    backupId: string,
    userId: string,
    initiatingSessionHash: string,
    initiatingSessionExpiresAt: Date,
) {
    const auditContext = prepareAuditContextService(userId)
    const result = await db.transaction(async function (transaction) {
        await requireMutationPermissionService(
            transaction,
            userId,
            PERMISSIONS.ADMIN_BACKUPS,
        )
        await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtext(${'rentnerproxy-marketplace:backup:restore-enqueue'}))`,
        )
        const activeRestores = await transaction
            .select({ id: backupRuns.id })
            .from(backupRuns)
            .where(
                and(
                    eq(backupRuns.trigger, 'restore'),
                    inArray(backupRuns.status, ['queued', 'running']),
                ),
            )
            .limit(1)

        if (activeRestores.length > 0) {
            throw new Error(
                'Es ist bereits eine Wiederherstellung eingeplant oder aktiv.',
            )
        }

        const sourceRows = await transaction
            .select()
            .from(backupRuns)
            .where(eq(backupRuns.id, backupId))
            .limit(1)
            .for('update')
        const source = sourceRows.at(0)

        if (
            !source?.fileName ||
            source.status !== 'completed' ||
            !source.checksumSha256 ||
            !/^[a-f0-9]{64}$/i.test(source.checksumSha256)
        ) {
            throw new Error(
                'Das Backup ist nicht vollständig verifiziert und daher nicht für eine Wiederherstellung verfügbar.',
            )
        }

        const rows = await transaction
            .insert(backupRuns)
            .values({
                trigger: 'restore',
                status: 'queued',
                targetKey: BACKUP_TARGET_KEY,
                includesStorage: source.includesStorage,
                createdByUserId: userId,
            })
            .returning({ id: backupRuns.id })
        const run = rows.at(0)

        if (!run) {
            throw new Error('Der Restore-Lauf konnte nicht angelegt werden.')
        }

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'admin.backups.restore_queued',
                message: 'Backup-Wiederherstellung wurde eingeplant.',
                newValues: { backupId, restoreRunId: run.id },
            },
        )
        return { runId: run.id, auditReceipt }
    })
    const { runId } = result
    await publishCommittedAuditLogService(result.auditReceipt)

    try {
        await saveRestoreInitiatorSessionBindingService(
            runId,
            initiatingSessionHash,
            initiatingSessionExpiresAt,
        )
        await getBackupQueue().add(
            'restore-backup',
            {
                contractVersion: 2,
                kind: 'restore',
                runId,
                sourceBackupId: backupId,
            },
            { attempts: 1, jobId: runId },
        )
    } catch (error) {
        await deleteRestoreInitiatorSessionBindingBestEffortService(runId)
        await markRunAsQueueFailed(runId, error, userId)
        throw error
    }

    return { success: true as const, runId }
}

export async function executeRestoreBackup(
    job: Extract<BackupJobData, { kind: 'restore' }>,
    options: BackupJobExecutionOptions = {},
) {
    try {
        return await executeRestoreBackupService(job, options)
    } finally {
        await deleteRestoreInitiatorSessionBindingBestEffortService(job.runId)
    }
}

async function executeRestoreBackupService(
    job: Extract<BackupJobData, { kind: 'restore' }>,
    options: BackupJobExecutionOptions,
) {
    const restoreStartedAt = new Date()
    const restoreStartedAtIso = restoreStartedAt.toISOString()
    let source: BackupRunRecord | null = null
    let preservedFileRuns: Array<BackupRunRecord> = []
    let restoreCompletedAt = restoreStartedAt
    let restoreWasCommitted = false
    let restoreJournal: RestoreJournal | undefined
    let journalWriteFailed = false
    let restoreMutationMayHaveStarted = false
    let journalFailureEvent: 'failed' | 'recovery-required' | undefined
    let initiatorSession: Awaited<
        ReturnType<typeof getRestoreInitiatorSessionService>
    > = null
    const existingRestoreRun = await getBackupRunById(job.runId)

    if (!existingRestoreRun) {
        throw new Error('Der zugehörige Restore-Lauf existiert nicht mehr.')
    }

    if (existingRestoreRun.status === 'running') {
        await markStalledRestoreRecoveryRequired(existingRestoreRun)
    }

    if (existingRestoreRun.status !== 'queued') {
        throw new Error(
            'Der zugehörige Restore-Lauf befindet sich nicht in einem ausführbaren Zustand.',
        )
    }

    const startedRestoreRuns = await db
        .update(backupRuns)
        .set({ status: 'running', startedAt: restoreStartedAt })
        .where(
            and(eq(backupRuns.id, job.runId), eq(backupRuns.status, 'queued')),
        )
        .returning({
            id: backupRuns.id,
            includesStorage: backupRuns.includesStorage,
        })

    const startedRestoreRun = startedRestoreRuns.at(0)

    if (!startedRestoreRun) {
        throw new Error('Der zugehörige Restore-Lauf existiert nicht mehr.')
    }
    const confirmedStartedRestoreRun = startedRestoreRun

    const initialProgress: BackupRestoreProgress = {
        version: 1,
        phase: 'preparing',
        percent: 0,
        processedBytes: 0,
        totalBytes: 0,
        updatedAt: new Date().toISOString(),
    }
    const initialState = await writeRestoreStateService(
        getRestoreStateFromProgress(initialProgress, restoreStartedAtIso),
    )
    let barrierWasEntered = false
    let barrierOperationWasCompleted = false

    async function persistPreservedFileRuns(index = 0): Promise<void> {
        const preservedFileRun = preservedFileRuns[index]

        if (!preservedFileRun) {
            return
        }

        await persistBackupRunAfterRestore(preservedFileRun)
        return persistPreservedFileRuns(index + 1)
    }

    async function appendRestoreJournal(
        event: Parameters<RestoreJournal['append']>[0],
    ) {
        if (!restoreJournal) throw new Error('Das Restore-Journal fehlt.')
        try {
            await restoreJournal.append(event)
        } catch (error) {
            journalWriteFailed = true
            throw error
        }
    }

    async function persistRestoreFailureState(
        error: unknown,
        forceRecoveryRequired = false,
    ) {
        const completedAt = new Date()
        let recoveryIsRequired =
            forceRecoveryRequired ||
            restoreWasCommitted ||
            error instanceof RestoreRollbackError ||
            (journalWriteFailed && restoreMutationMayHaveStarted)
        if (
            restoreJournal &&
            !journalWriteFailed &&
            journalFailureEvent !== 'recovery-required'
        ) {
            const failureEvent = recoveryIsRequired
                ? 'recovery-required'
                : 'failed'
            if (failureEvent !== journalFailureEvent) {
                try {
                    await appendRestoreJournal(failureEvent)
                    journalFailureEvent = failureEvent
                } catch (journalError) {
                    recoveryIsRequired ||= restoreMutationMayHaveStarted
                    logRestoreJournalFailureBestEffort(
                        'backup.restore.journal_failure_record_failed',
                        journalError,
                    )
                }
            }
        }
        const failedAt = completedAt.toISOString()

        try {
            if (recoveryIsRequired) {
                const recoveryRequiredState = await writeRestoreStateService({
                    status: 'recovery-required',
                    phase: restoreWasCommitted ? 'finalizing' : 'rolling-back',
                    percent: null,
                    processedBytes: 0,
                    totalBytes: 0,
                    startedAt: restoreStartedAtIso,
                    updatedAt: failedAt,
                })
                await publishRestoreStateBestEffort(recoveryRequiredState)
            }

            if (preservedFileRuns.length > 0) {
                await persistPreservedFileRuns()
            }
            await persistBackupRunAfterRestore({
                id: job.runId,
                trigger: 'restore',
                status: 'failed',
                targetKey: BACKUP_TARGET_KEY,
                includesStorage:
                    source?.includesStorage ??
                    confirmedStartedRestoreRun.includesStorage,
                fileName: null,
                fileSize: null,
                checksumSha256: null,
                errorMessage: BACKUP_FAILURE_MESSAGE,
                startedAt: restoreStartedAt,
                completedAt,
                createdByUserId: null,
            })

            if (!recoveryIsRequired) {
                const failedState = await writeRestoreStateService({
                    status: 'failed',
                    phase: 'rolling-back',
                    percent: null,
                    processedBytes: 0,
                    totalBytes: 0,
                    startedAt: restoreStartedAtIso,
                    updatedAt: failedAt,
                })
                await publishRestoreStateBestEffort(failedState)
            }
        } catch (metadataError) {
            throw new AggregateError(
                [error, metadataError],
                'Restore und Speicherung des Fehlerstatus sind fehlgeschlagen.',
                { cause: metadataError },
            )
        }
    }

    try {
        return await withExclusiveStorageMutationBarrier(async function () {
            barrierWasEntered = true

            try {
                const restoreActorUserId = existingRestoreRun.createdByUserId
                if (!restoreActorUserId) {
                    throw new Error(
                        'Der Restore besitzt keinen nachweisbaren auslösenden Benutzer.',
                    )
                }
                const initiatingSessionHash =
                    await consumeRestoreInitiatorSessionBindingService(
                        job.runId,
                    )

                if (initiatingSessionHash) {
                    initiatorSession = await getRestoreInitiatorSessionService(
                        restoreActorUserId,
                        initiatingSessionHash,
                    )
                }

                await reportRestoreProgressBestEffort(
                    initialProgress,
                    initialState,
                    options.reportProgress,
                )
                await requestRestorePageReloadForLegacyClientsBestEffort()
                source = await getBackupRunById(job.sourceBackupId)

                if (!source?.fileName || source.status !== 'completed') {
                    throw normalizeError(
                        new Error('Das Quell-Backup ist nicht mehr verfügbar.'),
                    )
                }

                if (!source.checksumSha256) {
                    throw normalizeError(
                        new Error(
                            'Das Quell-Backup hat keine verifizierbare SHA-256-Prüfsumme.',
                        ),
                    )
                }
                assertExpectedChecksum(source.checksumSha256)
                const restorableSource = source
                restoreJournal = await createRestoreJournalService({
                    restoreRunId: job.runId,
                    actorUserId: restoreActorUserId,
                    sourceBackupId: source.id,
                    sourceChecksumSha256: source.checksumSha256.toLowerCase(),
                    includesStorage: source.includesStorage,
                })

                preservedFileRuns = await collectExistingBackupFiles(source.id)

                const filePath = await getBackupFilePath(source.fileName)
                await restoreBackupArchive({
                    filePath,
                    expectedChecksumSha256: source.checksumSha256,
                    expectedIncludesStorage: source.includesStorage,
                    storageMutationBarrierHeld: true,
                    onProgress: async function (progress) {
                        const state = await writeRestoreStateService(
                            getRestoreStateFromProgress(
                                progress,
                                restoreStartedAtIso,
                            ),
                        )
                        await reportRestoreProgressBestEffort(
                            progress,
                            state,
                            options.reportProgress,
                        )
                    },
                    beforeRestoreMutation: async function () {
                        await appendRestoreJournal('rewind-ready')
                        restoreMutationMayHaveStarted = true
                    },
                    afterDatabaseRestore: async function () {
                        await replaceRestoredAuthenticationStateService(
                            initiatorSession,
                        )
                    },
                    afterRestoreApplied: async function () {
                        restoreCompletedAt = new Date()
                        await Promise.all(
                            preservedFileRuns.map(persistBackupRunAfterRestore),
                        )
                        await persistBackupRunAfterRestore({
                            id: job.runId,
                            trigger: 'restore',
                            status: 'completed',
                            targetKey: BACKUP_TARGET_KEY,
                            includesStorage: restorableSource.includesStorage,
                            fileName: null,
                            fileSize: null,
                            checksumSha256: null,
                            errorMessage: null,
                            startedAt: restoreStartedAt,
                            completedAt: restoreCompletedAt,
                            createdByUserId: null,
                        })
                        await appendRestoreJournal('applied')
                    },
                })

                restoreWasCommitted = true
                await synchronizeRuntimeAfterRestoreBestEffort(
                    restoreCompletedAt,
                )
                await applyBackupRetentionBestEffort(new Set([source.id]))
                const completeRestoreQuiescence =
                    options.completeRestoreQuiescence ??
                    async function (publishCompletedState) {
                        await publishCompletedState()
                    }
                await completeRestoreQuiescence(async function () {
                    await appendRestoreJournal('completed')
                    const completedProgress: BackupRestoreProgress = {
                        version: 1,
                        phase: 'finalizing',
                        percent: 100,
                        processedBytes: 0,
                        totalBytes: 0,
                        updatedAt: restoreCompletedAt.toISOString(),
                    }
                    const completedState = await writeRestoreStateService({
                        ...getRestoreStateFromProgress(
                            completedProgress,
                            restoreStartedAtIso,
                        ),
                        status: 'completed',
                    })
                    await reportRestoreProgressBestEffort(
                        completedProgress,
                        completedState,
                        options.reportProgress,
                    )
                })
                barrierOperationWasCompleted = true
                return job.runId
            } catch (error) {
                await persistRestoreFailureState(error)
                throw error
            }
        })
    } catch (error) {
        if (barrierWasEntered) {
            if (barrierOperationWasCompleted) {
                await persistRestoreFailureState(error, true)
            }

            throw error
        }

        await persistRestoreFailureState(error, true)
        throw error
    } finally {
        try {
            await restoreJournal?.close()
        } catch (error) {
            logRestoreJournalFailureBestEffort(
                'backup.restore.journal_close_failed',
                error,
            )
        }
    }
}

async function markStalledRestoreRecoveryRequired(run: BackupRunRecord) {
    let existingState: Awaited<ReturnType<typeof getRestoreStateService>> = null

    try {
        existingState = await getRestoreStateService()
    } catch (error) {
        logError('backup.restore.stalled_state_read_failed', error)
    }

    const updatedAt = new Date().toISOString()
    const state = await writeRestoreStateService({
        status: 'recovery-required',
        phase: 'rolling-back',
        percent: null,
        processedBytes: 0,
        totalBytes: 0,
        startedAt:
            existingState?.startedAt ??
            run.startedAt?.toISOString() ??
            updatedAt,
        updatedAt,
    })
    await publishRestoreStateBestEffort(state)
}

async function reportRestoreProgressBestEffort(
    progress: BackupRestoreProgress,
    state: Awaited<ReturnType<typeof writeRestoreStateService>>,
    reportProgress: BackupProgressReporter | undefined,
) {
    await Promise.all([
        (async function () {
            try {
                await reportProgress?.(progress)
            } catch (error) {
                logError('backup.restore.queue_progress_failed', error)
            }
        })(),
        publishRestoreStateBestEffort(state),
    ])
}

async function publishRestoreStateBestEffort(
    state: Awaited<ReturnType<typeof writeRestoreStateService>>,
) {
    try {
        await publishSystemRestoreChangedService(state)
    } catch (error) {
        logError('backup.restore.state_publish_failed', error)
    }
}

async function requestRestorePageReloadForLegacyClientsBestEffort() {
    await wait(500)

    try {
        await publishRealtimeReauthenticationRequiredService({
            reason: 'restore',
            requestedAt: new Date().toISOString(),
        })
    } catch (error) {
        logError('backup.restore.start_reload_publish_failed', error)
    }
}

async function collectExistingBackupFiles(sourceBackupId: string) {
    const fileRuns = await db
        .select()
        .from(backupRuns)
        .where(
            and(
                eq(backupRuns.status, 'completed'),
                isNotNull(backupRuns.fileName),
            ),
        )
    const validatedRuns = await Promise.all(
        fileRuns.map(async function (run) {
            try {
                if (!run.fileName) {
                    throw new Error('Der Backup-Dateiname fehlt im Katalog.')
                }
                const fileStats = await stat(
                    await getBackupFilePath(run.fileName),
                )

                if (!fileStats.isFile()) {
                    throw normalizeError(
                        new Error(
                            'Der Katalogeintrag verweist nicht auf eine Datei.',
                        ),
                    )
                }

                if (run.fileSize !== null && fileStats.size !== run.fileSize) {
                    throw normalizeError(
                        new Error(
                            'Die Dateigröße stimmt nicht mit dem Katalog überein.',
                        ),
                    )
                }

                return run
            } catch (error) {
                if (run.id !== sourceBackupId) {
                    logError('backup.restore.catalog_entry_skipped', error, {
                        runId: run.id,
                    })
                    return null
                }

                throw new Error(
                    `Der aktuelle Backup-Katalog kann für Lauf ${run.id} nicht vollständig gesichert werden. Der Restore wurde vor dem Datenbank-Rewind abgebrochen.`,
                    { cause: error },
                )
            }
        }),
    )

    return validatedRuns.filter((run) => run !== null)
}

async function synchronizeRuntimeAfterRestoreBestEffort(completedAt: Date) {
    await Promise.all([
        (async function () {
            try {
                const restoredSettings = serializeBackupSettings(
                    await getOrCreateBackupSettings(),
                )
                await syncBackupScheduler(restoredSettings)
            } catch (error) {
                logError('backup.restore.scheduler_sync_failed', error)
            }
        })(),
        (async function () {
            try {
                await publishRealtimeReauthenticationRequiredService({
                    reason: 'restore',
                    requestedAt: completedAt.toISOString(),
                })
            } catch (error) {
                logError(
                    'backup.restore.reauthentication_publish_failed',
                    error,
                )
            }
        })(),
    ])
}
