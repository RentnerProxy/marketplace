import { createBoundedBackupStreamService } from './backup-bounded-stream.service.ts'
import path from 'node:path'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
    BACKUP_FILE_PERMISSIONS,
    BACKUP_LIMITS,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'
import { removePathBestEffort } from './archive-files.service.ts'
import type { BackupImportContext } from './import.types.ts'

export function validateBackupUploadRequest(request: Request): number | null {
    if (
        request.headers.get('content-type')?.trim().toLowerCase() !==
            BACKUP_UPLOAD_CONTENT_TYPE ||
        !request.body
    ) {
        throw new Error('Es wurde kein gültiger Backup-Upload übermittelt.')
    }

    const declaredContentLength = request.headers.get('content-length')
    if (declaredContentLength === null) return null
    if (!/^\d+$/.test(declaredContentLength)) {
        throw new Error('Die deklarierte Uploadgröße ist ungültig.')
    }

    const declaredBytes = Number(declaredContentLength)
    if (
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes > BACKUP_LIMITS.maxArchiveBytes
    ) {
        throw new Error('Der Backup-Upload überschreitet das Größenlimit.')
    }
    return declaredBytes
}

async function removeOwnedUpload(
    filePath: string,
    context: BackupImportContext,
) {
    try {
        if (
            !(await removePathBestEffort(
                filePath,
                'backup.upload.temp_cleanup_failed',
            ))
        ) {
            throw new Error(
                'Die Uploaddatei konnte nicht vollständig entfernt werden.',
            )
        }
    } catch (error) {
        context.markCleanupIncomplete()
        throw error
    }
}

export async function receiveBackupUpload(
    request: Request,
    context: BackupImportContext,
) {
    const declaredBytes = validateBackupUploadRequest(request)
    context.assertActive()
    if (declaredBytes !== null && declaredBytes > context.maximumUploadBytes) {
        throw new Error('Der Backup-Upload überschreitet das Größenlimit.')
    }
    const requestBody = request.body
    if (!requestBody) {
        throw new Error('Es wurde kein gültiger Backup-Upload übermittelt.')
    }
    const temporaryFile = path.join(context.temporaryDirectory, 'upload.enc')
    let ownsFile = false

    try {
        const fileHandle = await open(
            temporaryFile,
            'wx',
            BACKUP_FILE_PERMISSIONS.file,
        )
        ownsFile = true
        const limit = createBoundedBackupStreamService(context, {
            getMaximumBytes: () =>
                Math.min(
                    context.maximumUploadBytes,
                    BACKUP_LIMITS.maxArchiveBytes,
                ),
            invalidChunkMessage: 'Der Backup-Upload ist ungültig.',
            sizeLimitMessage:
                'Der Backup-Upload überschreitet das Größenlimit.',
        })
        try {
            context.assertActive()
            await pipeline(
                Readable.from(requestBody),
                limit.stream,
                fileHandle.createWriteStream(),
                { signal: context.signal },
            )
        } finally {
            await limit.settle()
            await fileHandle.close().catch(function (error) {
                context.markCleanupIncomplete()
                throw error
            })
        }
        context.assertActive()
        if (
            declaredBytes !== null &&
            limit.getObservedBytes() !== declaredBytes
        ) {
            throw new Error(
                'Die Uploadgröße stimmt nicht mit der Deklaration überein.',
            )
        }

        return {
            dispose: async function () {
                await removeOwnedUpload(temporaryFile, context)
            },
            filePath: temporaryFile,
        }
    } catch (error) {
        if (ownsFile) {
            const cleanupFailure = await removeOwnedUpload(
                temporaryFile,
                context,
            ).then(
                () => undefined,
                (cleanupError: unknown) => ({ error: cleanupError }),
            )
            if (cleanupFailure) {
                throw new AggregateError(
                    [error, cleanupFailure.error],
                    'Der Upload und seine Bereinigung sind fehlgeschlagen.',
                    { cause: error },
                )
            }
        }
        throw error
    }
}
