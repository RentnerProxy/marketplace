export type BackupArchiveEncryptionMetadata = {
    archiveSize: number
    checksumSha256: string
    plaintextSize: number
}

export type BackupArchiveSourceIdentity = {
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
