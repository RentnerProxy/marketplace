import { BACKUP_IMPORT_LIMITS, BACKUP_LIMITS } from '@/config/backup.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import {
    archiveAdmissionSchema,
    parseArchiveCoreResultService,
} from './archive-core.schema.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { BackupImportError } from './import.errors.ts'
import type {
    AcquireBackupImportAdmissionInput,
    BackupImportAdmission,
} from './import.types.ts'

function importError(error: unknown): never {
    if (error instanceof Error && 'code' in error) {
        if (error.code === 'ARCHIVE_IMPORT_BUSY')
            throw new BackupImportError(429, error.message)
        if (
            error.code === 'ARCHIVE_CAPACITY_EXCEEDED' ||
            error.code === 'ARCHIVE_BUDGET_EXCEEDED'
        )
            throw new BackupImportError(507, error.message)
        if (error.code === 'CORE_CANCELLED')
            throw new BackupImportError(408, error.message)
        if (
            error.code === 'ARCHIVE_CAPACITY_UNAVAILABLE' ||
            error.code === 'ARCHIVE_CLEANUP_INCOMPLETE'
        )
            throw new BackupImportError(503, error.message)
    }
    throw error
}

export async function acquireBackupImportAdmissionService(
    input: AcquireBackupImportAdmissionInput,
): Promise<BackupImportAdmission> {
    if (
        !Number.isSafeInteger(input.maximumUploadBytes) ||
        input.maximumUploadBytes < 0 ||
        input.maximumUploadBytes > BACKUP_LIMITS.maxArchiveBytes
    ) {
        throw new Error('Ungültiges Backup-Importbudget.')
    }
    const controller = new AbortController()
    function abort() {
        controller.abort(
            new BackupImportError(408, 'Der Backup-Import wurde abgebrochen.'),
        )
    }
    if (input.requestSignal.aborted) abort()
    input.requestSignal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, BACKUP_IMPORT_LIMITS.maximumDurationMs)
    timeout.unref()
    function stopDeadline() {
        clearTimeout(timeout)
        input.requestSignal.removeEventListener('abort', abort)
    }
    let releasing = false
    let cleanupIncomplete = false
    let pending = Promise.resolve()
    let reserved = 0
    let consumed = 0
    const maximumWorkingBytes =
        input.maximumUploadBytes * 2 +
        Math.max(0, input.maximumUploadBytes - 70)
    let releasePromise: Promise<void> | undefined
    function assertActive() {
        if (controller.signal.aborted) throw controller.signal.reason
        if (releasing)
            throw new BackupImportError(
                408,
                'Der Backup-Import wurde abgebrochen.',
            )
    }
    let temporaryDirectory: string
    let token: string
    try {
        assertActive()
        temporaryDirectory = await getBackupFilePath(
            BACKUP_IMPORT_LIMITS.admissionDirectoryName,
        )
        assertActive()
        // Acquisition must finish and return its lease even if the request aborts meanwhile.
        const leaseReply = await runCoreCommandService<{ token: string }>(
            'archive',
            {
                operation: 'admissionAcquire',
                directory: temporaryDirectory,
                maximumUploadBytes: input.maximumUploadBytes,
            },
            {
                validateResult: (result) =>
                    archiveAdmissionSchema.parse(result),
            },
        )
        token = leaseReply.token
    } catch (error) {
        stopDeadline()
        return importError(error)
    }
    return {
        signal: controller.signal,
        temporaryDirectory,
        maximumUploadBytes: input.maximumUploadBytes,
        assertActive,
        markCleanupIncomplete() {
            cleanupIncomplete = true
        },
        beforeWrite(byteLength) {
            const operation = pending
                .then(async () => {
                    assertActive()
                    if (!Number.isSafeInteger(byteLength) || byteLength < 0)
                        throw new BackupImportError(
                            507,
                            'Das Importbudget ist ungültig.',
                        )
                    if (byteLength > maximumWorkingBytes - consumed)
                        throw new BackupImportError(
                            507,
                            'Das Speicherbudget für den Backup-Import wurde überschritten.',
                        )
                    if (consumed + byteLength > reserved) {
                        const reserveBytes = Math.min(
                            maximumWorkingBytes - reserved,
                            Math.max(
                                16 * 1024 * 1024,
                                consumed + byteLength - reserved,
                            ),
                        )
                        await runCoreCommandService(
                            'archive',
                            {
                                operation: 'admissionReserve',
                                directory: temporaryDirectory,
                                token,
                                byteLength: reserveBytes,
                            },
                            {
                                signal: controller.signal,
                                validateResult: (result) =>
                                    parseArchiveCoreResultService<null>(
                                        'admissionReserve',
                                        result,
                                    ),
                            },
                        )
                        reserved += reserveBytes
                    }
                    consumed += byteLength
                    assertActive()
                    return undefined
                })
                .catch((error: unknown) => {
                    try {
                        importError(error)
                    } catch (mapped) {
                        controller.abort(mapped)
                        throw mapped
                    }
                })
            pending = operation
            void operation.catch(() => undefined)
            return operation
        },
        release() {
            if (releasePromise) return releasePromise
            releasing = true
            stopDeadline()
            releasePromise = (async () => {
                await pending.catch(() => undefined)
                if (cleanupIncomplete) {
                    await runCoreCommandService(
                        'archive',
                        {
                            operation: 'admissionMarkIncomplete',
                            directory: temporaryDirectory,
                            token,
                        },
                        {
                            validateResult: (result) =>
                                parseArchiveCoreResultService<null>(
                                    'admissionMarkIncomplete',
                                    result,
                                ),
                        },
                    )
                }
                await runCoreCommandService(
                    'archive',
                    {
                        operation: 'admissionRelease',
                        directory: temporaryDirectory,
                        token,
                    },
                    {
                        validateResult: (result) =>
                            parseArchiveCoreResultService<null>(
                                'admissionRelease',
                                result,
                            ),
                    },
                )
            })().catch(importError)
            return releasePromise
        },
    }
}
