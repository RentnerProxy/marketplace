export type BackupBoundedStreamOptions = {
    getMaximumBytes: () => number
    invalidChunkMessage: string
    sizeLimitMessage: string
}
