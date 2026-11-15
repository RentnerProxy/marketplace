export type PrepareBackupDownloadInput = {
    fileName: string
    fileSize: number | null
    checksumSha256: string | null
    signal?: AbortSignal
}

export type PreparedBackupDownload = {
    fileName: string
    fileSize: number
    createBody: () => ReadableStream<Uint8Array>
    dispose: () => Promise<void>
}
