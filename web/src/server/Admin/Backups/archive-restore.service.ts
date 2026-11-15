import { stageBackup } from './archive-staging.service.ts'
import { preparePrivateStorageDirectoryService } from '@/server/Storage/private-files.service.ts'
import { RestoreRollbackError } from './archive-restore.errors.ts'
import {
    prepareStorageRecovery,
    assertStorageRecoveryCapacityService,
    prepareBackgroundStorageRecovery,
    syncRestoredStorageTree,
} from './archive-storage-recovery.service.ts'
import { getPrivateStorageRoot } from '@/lib/Images/publicImagePaths.ts'
import {
    assertBackgroundStoragePathsService,
    collectBackgroundStorageFilesService,
    partitionRestoredBackgroundStorageService,
} from './archive-background-storage.service.ts'
import type { StorageRecoveryHandle } from './Types/archive-storage-recovery.types.ts'
import type { PreparedBackgroundStorage } from './Types/archive-background-storage.types.ts'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import {
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_LIMITS,
    BACKUP_MANIFEST_VERSION,
} from '@/config/backup.config.ts'
import { normalizeError } from '@/lib/Errors/error.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { logError, logWarn } from '@/server/Logging/logger.ts'
import { withExclusiveStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import { hasUncertainStorageMutationFailureService } from '@/server/Storage/storage-mutation-failure.service.ts'
import type { BackupRestoreProgress } from '@/lib/Backups/Types/backup.types.ts'
import { createPostgresDump, restorePostgresDump } from './process.service.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import {
    assertDirectoryMutationPermissions,
    createPrivateTempDirectory,
    hasFileSystemErrorCode,
    isPathInside,
    removePathBestEffort,
    syncDirectory,
    syncFile,
} from './archive-files.service.ts'
import { extractBackupArchive } from './archive-validation.service.ts'
import type { ValidatedBackupArchive } from './Types/archive-validation.types.ts'
import type { RestoreExtractedBackupArchiveInput } from './Types/archive-restore.types.ts'
import { withBackupArchiveSourceService } from './archive-plaintext.service.ts'
import type {
    BackupProgressReporter,
    RestoreBackupArchiveInput,
} from './backup-service.types.ts'
const RESTORE_PROGRESS_RETRY_DELAY_MS = 5_000
function getScaledPercent(
    start: number,
    end: number,
    processedBytes: number,
    totalBytes: number,
) {
    if (totalBytes <= 0) {
        return start
    }
    return Math.min(
        end,
        Math.max(
            start,
            Math.round(start + ((end - start) * processedBytes) / totalBytes),
        ),
    )
}
function createRestoreProgressEmitter(
    reportProgress: BackupProgressReporter<BackupRestoreProgress> | undefined,
) {
    let failedPhase: BackupRestoreProgress['phase'] | null = null
    let retryAfter = 0
    let lastPhase: BackupRestoreProgress['phase'] | undefined
    let lastPublishedAt = 0
    let pendingUpdate = Promise.resolve()
    return function emitProgress(
        phase: BackupRestoreProgress['phase'],
        percent: number | null,
        processedBytes = 0,
        totalBytes = 0,
    ) {
        if (!reportProgress) {
            return pendingUpdate
        }
        const now = Date.now()
        const isPhaseChange = phase !== lastPhase
        const isExactPhaseEnd = totalBytes > 0 && processedBytes >= totalBytes
        if (phase === failedPhase && now < retryAfter) {
            return pendingUpdate
        }
        if (!isPhaseChange && !isExactPhaseEnd && now - lastPublishedAt < 500) {
            return pendingUpdate
        }
        lastPhase = phase
        lastPublishedAt = now
        pendingUpdate = pendingUpdate.then(async function () {
            try {
                await reportProgress({
                    version: 1,
                    phase,
                    percent,
                    processedBytes,
                    totalBytes,
                    updatedAt: new Date().toISOString(),
                })
                failedPhase = null
                retryAfter = 0
            } catch (error) {
                failedPhase = phase
                retryAfter = Date.now() + RESTORE_PROGRESS_RETRY_DELAY_MS
                logError('backup.restore.progress_reporting_failed', error, {
                    phase,
                })
            }
            return undefined
        })
        return pendingUpdate
    }
}
function assertAppVersionCompatible(validated: ValidatedBackupArchive) {
    const currentAppVersion = process.env.VITE_APP_VERSION ?? 'unknown'
    if (
        currentAppVersion === 'unknown' ||
        validated.manifest.appVersion === 'unknown'
    ) {
        throw new Error(
            'Die App-Version des Backups oder der laufenden Anwendung ist unbekannt. Ein automatischer Restore ist nicht sicher möglich.',
        )
    }
    if (validated.manifest.appVersion !== currentAppVersion) {
        throw new Error(
            `Das Backup wurde mit App-Version ${validated.manifest.appVersion} erstellt und kann nicht automatisch mit ${currentAppVersion} wiederhergestellt werden.`,
        )
    }
}
function assertStorageRootIsSafe(storageRoot: string) {
    const filesystemRoot = path.parse(storageRoot).root
    const workingDirectory = path.resolve(process.cwd())
    if (
        storageRoot === filesystemRoot ||
        isPathInside(storageRoot, workingDirectory)
    ) {
        throw new Error(
            'Der konfigurierte Storage-Pfad ist für einen Restore zu allgemein.',
        )
    }
}
function assertProtectedPathIsOutsideStorage(
    storageRoot: string,
    protectedPath: string,
) {
    if (isPathInside(storageRoot, path.resolve(protectedPath))) {
        throw new Error(
            'Der konfigurierte Storage enthält einen geschützten Backup- oder Staging-Pfad.',
        )
    }
}
async function assertStorageRoot(storageRoot: string) {
    try {
        const storageStats = await lstat(storageRoot)
        if (storageStats.isSymbolicLink() || !storageStats.isDirectory()) {
            throw new Error(
                'Der konfigurierte Storage ist kein echtes Verzeichnis.',
            )
        }
    } catch (error) {
        if (!hasFileSystemErrorCode(error, 'ENOENT')) {
            throw error
        }
        await mkdir(storageRoot, {
            mode: 0o700,
            recursive: true,
        })
    }
}
async function createRecoveryDatabaseDump(destinationPath: string) {
    await createPostgresDump(destinationPath)
    const recoveryStats = await lstat(destinationPath)
    if (
        !recoveryStats.isFile() ||
        recoveryStats.isSymbolicLink() ||
        recoveryStats.size <= 0 ||
        recoveryStats.size > BACKUP_LIMITS.maxExtractedBytes
    ) {
        throw new Error(
            'Der temporäre Datenbank-Rücksetzpunkt ist ungültig oder zu groß.',
        )
    }
    await chmod(destinationPath, 0o600)
    await syncFile(destinationPath)
    await syncDirectory(path.dirname(destinationPath))
}
async function restoreExtractedBackupArchive(
    input: RestoreExtractedBackupArchiveInput,
) {
    const databaseDumpPath = path.join(input.restoreDirectory, 'database.dump')
    const databaseStats = await lstat(databaseDumpPath)
    if (!databaseStats.isFile() || databaseStats.size === 0) {
        throw normalizeError(
            new Error('Der Datenbank-Dump ist keine gültige Datei.'),
        )
    }
    const applyRestore = async function () {
        const recoveryDatabaseDumpPath = await getBackupFilePath(
            `.restore-database-before-${randomUUID()}.dump`,
        )
        const pendingStorageRecoveries: StorageRecoveryHandle[] = []
        let databaseRestoreWasAttempted = false
        let restoreDataWasApplied = false
        let preserveRecoveryDatabaseDump = false
        let restoreFailure:
            | {
                  error: unknown
              }
            | undefined
        try {
            await assertDirectoryMutationPermissions(
                path.dirname(input.storageRoot),
            )
            await input.emitProgress('creating-recovery', 52)
            await createRecoveryDatabaseDump(recoveryDatabaseDumpPath)
            await input.beforeRestoreMutation?.()
            if (input.validated.manifest.includesStorage) {
                const restoredStoragePath = path.join(
                    input.restoreDirectory,
                    'storage',
                )
                const restoredStorageStats = await lstat(restoredStoragePath)
                if (
                    restoredStorageStats.isSymbolicLink() ||
                    !restoredStorageStats.isDirectory()
                ) {
                    throw normalizeError(
                        new Error(
                            'Der Storage-Inhalt des Backups ist kein gültiges Verzeichnis.',
                        ),
                    )
                }
                await syncRestoredStorageTree(restoredStoragePath)
                await input.emitProgress('replacing-storage', 60)
                if (!input.privateBackgrounds)
                    throw new Error('Missing private background staging')
                await preparePrivateStorageDirectoryService(
                    input.privateStorageRoot,
                    input.privateStorageRoot,
                )
                const originals = await collectBackgroundStorageFilesService({
                    storageRoot: input.privateStorageRoot,
                    location: 'private',
                })
                await assertStorageRecoveryCapacityService([
                    {
                        directoryPath: input.storageRoot,
                        sourcePaths: [input.storageRoot, restoredStoragePath],
                    },
                    {
                        directoryPath: input.privateStorageRoot,
                        sourcePaths: [
                            input.privateBackgrounds.restoredStoragePath,
                        ],
                        additionalBytes:
                            input.validated.manifest.version ===
                            BACKUP_MANIFEST_VERSION
                                ? originals.reduce(
                                      (total, entry) =>
                                          total + BigInt(entry.size),
                                      0n,
                                  )
                                : 0n,
                    },
                ])
                const publicRecovery = await prepareStorageRecovery({
                    restoredStoragePath,
                    storageRoot: input.storageRoot,
                    onProgress: function (processedEntries, totalEntries) {
                        void input.emitProgress(
                            'replacing-storage',
                            getScaledPercent(
                                60,
                                78,
                                processedEntries,
                                totalEntries,
                            ),
                        )
                    },
                })
                pendingStorageRecoveries.push(publicRecovery)
                const privateRecovery = await prepareBackgroundStorageRecovery({
                    storageRoot: input.privateStorageRoot,
                    restoredStoragePath:
                        input.privateBackgrounds.restoredStoragePath,
                    restoredRelativeFilePaths:
                        input.privateBackgrounds.relativeFilePaths,
                    originalEntries: originals,
                    completeSnapshot:
                        input.validated.manifest.version ===
                        BACKUP_MANIFEST_VERSION,
                })
                pendingStorageRecoveries.push(privateRecovery)
            }
            await input.emitProgress('restoring-database', 80)
            databaseRestoreWasAttempted = true
            await restorePostgresDump(databaseDumpPath)
            await input.afterDatabaseRestore?.()
            await input.emitProgress('finalizing', 95)
            await input.afterRestoreApplied?.()
            restoreDataWasApplied = true
            const commitErrors: unknown[] = []
            await forEachSequentially(
                pendingStorageRecoveries,
                async function (recovery) {
                    try {
                        await recovery.commit()
                    } catch (error) {
                        commitErrors.push(error)
                    }
                },
            )
            if (commitErrors.length > 0) {
                throw new RestoreRollbackError(
                    'Storage recovery cleanup failed',
                    commitErrors,
                    commitErrors[0],
                )
            }
            if (
                input.validated.manifest.includesStorage &&
                input.validated.manifest.version !== BACKUP_MANIFEST_VERSION
            ) {
                logWarn('backup.restore.legacy_private_background_coverage', {
                    manifestVersion: input.validated.manifest.version,
                    completePrivateSnapshot: false,
                })
            }
        } catch (error) {
            if (restoreDataWasApplied) {
                preserveRecoveryDatabaseDump = true
                restoreFailure = {
                    error:
                        error instanceof RestoreRollbackError
                            ? error
                            : new RestoreRollbackError(
                                  'Der Restore wurde angewendet, aber der abschließende Cleanup ist fehlgeschlagen.',
                                  [error],
                                  error,
                              ),
                }
            } else {
                const storageMutationIsUncertain =
                    hasUncertainStorageMutationFailureService(error)
                const rollbackErrors: unknown[] =
                    error instanceof RestoreRollbackError
                        ? [...error.rollbackErrors]
                        : []
                // A lost native acknowledgement can hide an applied recovery
                // whose handle never reached this process. Known handles alone
                // cannot prove that the complete storage state was rolled back.
                if (storageMutationIsUncertain && rollbackErrors.length === 0)
                    rollbackErrors.push(error)
                await input.emitProgress('rolling-back', null)
                if (databaseRestoreWasAttempted) {
                    try {
                        await restorePostgresDump(recoveryDatabaseDumpPath)
                    } catch (databaseRollbackError) {
                        rollbackErrors.push(databaseRollbackError)
                    }
                }
                await forEachSequentially(
                    pendingStorageRecoveries.toReversed(),
                    async function (recovery) {
                        try {
                            await recovery.rollback()
                        } catch (storageRollbackError) {
                            rollbackErrors.push(storageRollbackError)
                        }
                    },
                )
                if (rollbackErrors.length > 0) {
                    preserveRecoveryDatabaseDump = true
                    restoreFailure = {
                        error: new RestoreRollbackError(
                            storageMutationIsUncertain
                                ? 'Der Abschluss einer Storage-Änderung konnte nicht bestätigt werden. Der temporäre Datenbank-Rücksetzpunkt bleibt für die manuelle Wiederherstellung erhalten.'
                                : 'Restore und automatischer Rollback sind fehlgeschlagen. Der temporäre Datenbank-Rücksetzpunkt bleibt im Backup-Ordner erhalten.',
                            rollbackErrors,
                            error,
                        ),
                    }
                } else {
                    restoreFailure = {
                        error,
                    }
                }
            }
        }
        if (!preserveRecoveryDatabaseDump) {
            const recoveryDumpWasRemoved = await removePathBestEffort(
                recoveryDatabaseDumpPath,
                'backup.restore.database_recovery_cleanup_failed',
            )
            if (!recoveryDumpWasRemoved) {
                const cleanupError = new Error(
                    'Der temporäre Datenbank-Rücksetzpunkt konnte nicht vollständig entfernt werden.',
                )
                if (restoreFailure?.error instanceof RestoreRollbackError) {
                    restoreFailure.error.rollbackErrors.push(cleanupError)
                } else {
                    restoreFailure = {
                        error: new RestoreRollbackError(
                            'Der Restore-Zustand wurde angewendet oder zurückgesetzt, aber der temporäre Datenbank-Rücksetzpunkt konnte nicht sicher bereinigt werden.',
                            [cleanupError],
                            restoreFailure?.error ?? cleanupError,
                        ),
                    }
                }
            } else {
                try {
                    await syncDirectory(path.dirname(recoveryDatabaseDumpPath))
                } catch (error) {
                    logError(
                        'backup.restore.database_recovery_directory_sync_failed',
                        error,
                    )
                }
            }
        }
        if (restoreFailure) {
            throw restoreFailure.error
        }
    }
    if (input.storageMutationBarrierHeld) {
        await applyRestore()
        return
    }
    await withExclusiveStorageMutationBarrier(applyRestore)
}
export async function restoreBackupArchive(input: RestoreBackupArchiveInput) {
    const emitProgress = createRestoreProgressEmitter(input.onProgress)
    let stagingDirectory: string | undefined
    let preserveStagingDirectory = false
    let restoreFailure: unknown
    try {
        await emitProgress('preparing', 0)
        const prepared = await withBackupArchiveSourceService(
            {
                filePath: input.filePath,
            },
            async function ({ source, context }) {
                let resourcesClosed = true
                const operationContext = {
                    ...context,
                    markCleanupIncomplete() {
                        resourcesClosed = false
                        preserveStagingDirectory = true
                        context.markCleanupIncomplete()
                    },
                }
                const sourceDirectory = await createPrivateTempDirectory(
                    context.temporaryDirectory,
                    'restore-source-',
                )
                let extracted = false
                try {
                    const storageRoot = path.resolve(
                        getRequiredServerEnvironment('APP_STORAGE_DIR'),
                    )
                    assertStorageRootIsSafe(storageRoot)
                    assertProtectedPathIsOutsideStorage(
                        storageRoot,
                        input.filePath,
                    )
                    assertProtectedPathIsOutsideStorage(
                        storageRoot,
                        context.temporaryDirectory,
                    )
                    stagingDirectory = await createPrivateTempDirectory(
                        path.dirname(context.temporaryDirectory),
                        '.restore-extracted-',
                    )
                    assertProtectedPathIsOutsideStorage(
                        storageRoot,
                        stagingDirectory,
                    )
                    const storageParent = path.dirname(storageRoot)
                    await mkdir(storageParent, {
                        recursive: true,
                    })
                    await assertStorageRoot(storageRoot)
                    const sourcePath = await stageBackup({
                        source,
                        sourcePath: input.filePath,
                        expectedChecksumSha256: input.expectedChecksumSha256,
                        stagingDirectory: sourceDirectory,
                        stagingFileName:
                            'source-backup' + BACKUP_ARCHIVE_EXTENSION,
                        importContext: operationContext,
                        onProgress(processedBytes, totalBytes) {
                            void emitProgress(
                                'validating',
                                getScaledPercent(
                                    0,
                                    20,
                                    processedBytes,
                                    totalBytes,
                                ),
                                processedBytes,
                                totalBytes,
                            )
                        },
                    })
                    const validatedSource = await extractBackupArchive({
                        destinationDirectory: stagingDirectory,
                        expectedChecksumSha256: input.expectedChecksumSha256,
                        filePath: sourcePath,
                        importContext: operationContext,
                        onArchiveProgress(processedBytes, totalBytes) {
                            void emitProgress(
                                'validating',
                                getScaledPercent(
                                    20,
                                    50,
                                    processedBytes,
                                    totalBytes,
                                ),
                                processedBytes,
                                totalBytes,
                            )
                        },
                    })
                    assertAppVersionCompatible(validatedSource)
                    if (
                        input.expectedIncludesStorage !== undefined &&
                        validatedSource.manifest.includesStorage !==
                            input.expectedIncludesStorage
                    )
                        throw new Error(
                            'Der Storage-Umfang des Backups stimmt nicht mit dem Restore-Auftrag überein.',
                        )
                    const privateStorageRoot = getPrivateStorageRoot()
                    let privateBackgrounds:
                        PreparedBackgroundStorage | undefined
                    if (validatedSource.manifest.includesStorage) {
                        await assertBackgroundStoragePathsService({
                            storageRoot,
                            privateStorageRoot,
                            protectedPaths: [
                                input.filePath,
                                path.dirname(context.temporaryDirectory),
                                stagingDirectory,
                            ],
                        })
                        privateBackgrounds =
                            await partitionRestoredBackgroundStorageService(
                                stagingDirectory,
                            )
                    }
                    extracted = true
                    return {
                        validatedSource,
                        storageRoot,
                        privateStorageRoot,
                        privateBackgrounds,
                    }
                } finally {
                    if (resourcesClosed) {
                        const sourceRemoved = await removePathBestEffort(
                            sourceDirectory,
                            'backup.restore.source_cleanup_failed',
                        )
                        if (!sourceRemoved)
                            operationContext.markCleanupIncomplete()
                    }
                    if (!extracted && stagingDirectory && resourcesClosed) {
                        const extractedRemoved = await removePathBestEffort(
                            stagingDirectory,
                            'backup.restore.staging_cleanup_failed',
                        )
                        if (extractedRemoved) stagingDirectory = undefined
                        else operationContext.markCleanupIncomplete()
                    }
                    if (!resourcesClosed)
                        // oxlint-disable-next-line no-unsafe-finally -- Ungeschlossene Restore-Ressourcen dürfen keinen erfolgreichen Abschluss erlauben.
                        throw normalizeError(
                            new Error(
                                'Die Restore-Vorbereitung konnte nicht sicher bereinigt werden.',
                            ),
                        )
                }
            },
        )
        if (!stagingDirectory)
            throw new Error('Der geprüfte Restore-Inhalt fehlt.')
        return await restoreExtractedBackupArchive({
            validated: prepared.validatedSource,
            restoreDirectory: stagingDirectory,
            storageRoot: prepared.storageRoot,
            privateStorageRoot: prepared.privateStorageRoot,
            privateBackgrounds: prepared.privateBackgrounds,
            beforeRestoreMutation: input.beforeRestoreMutation,
            afterDatabaseRestore: input.afterDatabaseRestore,
            afterRestoreApplied: input.afterRestoreApplied,
            emitProgress,
            storageMutationBarrierHeld: input.storageMutationBarrierHeld,
        })
    } catch (error) {
        restoreFailure = error
        if (error instanceof RestoreRollbackError)
            preserveStagingDirectory = true
        throw error
    } finally {
        if (stagingDirectory && !preserveStagingDirectory) {
            const removed = await removePathBestEffort(
                stagingDirectory,
                'backup.restore.staging_cleanup_failed',
            )
            if (!removed) {
                const cleanupError = new Error(
                    'Der extrahierte Backup-Klartext konnte nicht vollständig bereinigt werden.',
                )
                if (restoreFailure instanceof RestoreRollbackError) {
                    restoreFailure.rollbackErrors.push(cleanupError)
                } else {
                    // oxlint-disable-next-line no-unsafe-finally -- Fehlgeschlagene Klartext-Bereinigung erfordert sichere manuelle Wiederherstellung.
                    throw normalizeError(
                        new RestoreRollbackError(
                            'Der Restore-Abschluss benötigt eine sichere manuelle Bereinigung.',
                            [cleanupError],
                            restoreFailure ?? cleanupError,
                        ),
                    )
                }
            }
        }
    }
}
