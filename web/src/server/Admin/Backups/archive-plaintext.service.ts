import { constants } from 'node:fs'

import { lstat, open } from 'node:fs/promises'

import {
    BACKUP_ARCHIVE_OVERHEAD_BYTES,
    BACKUP_LIMITS,
} from '@/config/backup.config.ts'
import { acquireBackupImportAdmissionService } from './import-admission.service.ts'

import type {
    BackupImportAdmission,
    BackupImportContext,
} from './Types/import.types.ts'
import type {
    BackupArchiveSourceInput,
    BackupArchiveSourceOperation,
} from './Types/archive-plaintext.types.ts'

export async function withBackupArchiveSourceService<T>(
    input: BackupArchiveSourceInput,
    operation: BackupArchiveSourceOperation<T>,
): Promise<T> {
    input.importContext?.assertActive()
    const before = await lstat(input.filePath, { bigint: true })
    if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        before.size < BigInt(BACKUP_ARCHIVE_OVERHEAD_BYTES) ||
        before.size > BigInt(BACKUP_LIMITS.maxArchiveBytes)
    )
        throw new Error(
            'Die verschlüsselte Backup-Quelldatei ist ungültig oder zu groß.',
        )
    const source = await open(
        input.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    let ownedAdmission: BackupImportAdmission | undefined
    let context: BackupImportContext | undefined = input.importContext
    try {
        const opened = await source.stat({ bigint: true })
        if (
            !opened.isFile() ||
            opened.nlink !== 1n ||
            opened.dev !== before.dev ||
            opened.ino !== before.ino ||
            opened.size !== before.size
        )
            throw new Error(
                'Die Backup-Quelldatei wurde während des Öffnens verändert.',
            )
        if (!context) {
            ownedAdmission = await acquireBackupImportAdmissionService({
                requestSignal: input.signal ?? new AbortController().signal,
                maximumUploadBytes: Number(opened.size),
                forRestore: input.forRestore,
            })
            context = ownedAdmission
        }
        context.assertActive()
        if (opened.size > BigInt(context.maximumUploadBytes))
            throw new Error(
                'Die Backup-Quelldatei überschreitet das zugelassene Budget.',
            )
        return await operation({ source, context })
    } finally {
        try {
            await source.close().catch((error) => {
                context?.markCleanupIncomplete()
                throw error
            })
        } finally {
            await ownedAdmission?.release()
        }
    }
}
