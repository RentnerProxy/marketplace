import type { FileHandle } from 'node:fs/promises'

import type { BackupImportContext } from './import.types.ts'

export type BackupArchiveSourceInput = {
    filePath: string
    importContext?: BackupImportContext
    signal?: AbortSignal
    forRestore?: boolean
}

type BackupArchiveSource = {
    source: FileHandle
    context: BackupImportContext
}

export type BackupArchiveSourceOperation<T> = (
    input: BackupArchiveSource,
) => Promise<T>
