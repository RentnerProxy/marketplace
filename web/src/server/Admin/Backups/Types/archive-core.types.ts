import type { BackupImportContext } from './import.types.ts'

export type ArchiveCoreOptions = {
    context?: BackupImportContext
    signal?: AbortSignal
    onProgress?: (
        processedBytes: number,
        totalBytes: number,
    ) => void | Promise<void>
}

export type BackupArchiveEncryptionMetadata = {
    archiveSize: number
    checksumSha256: string
    plaintextSize: number
}

type BackupArchiveSourceIdentity = {
    dev: string
    ino: string
    size: string
    mtimeNs: string
    ctimeNs: string
}

export type AuthenticateBackupArchiveInput = {
    sourcePath: string
    expectedSourceIdentity?: BackupArchiveSourceIdentity
    expectedChecksumSha256?: string
    signal?: AbortSignal
}
