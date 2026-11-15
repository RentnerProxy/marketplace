export type BackupImportContext = {
    signal: AbortSignal
    temporaryDirectory: string
    maximumUploadBytes: number
    assertActive: () => void
    beforeWrite: (byteLength: number) => Promise<void>
    markCleanupIncomplete: () => void
}

export type BackupImportAdmission = BackupImportContext & {
    release: () => Promise<void>
}

export type AcquireBackupImportAdmissionInput = {
    requestSignal: AbortSignal
    maximumUploadBytes: number
}

export type BackupImportErrorStatus = 408 | 429 | 503 | 507
