import type { BackgroundStorageEntry } from './archive-background-storage.types.ts'

export type StorageRecoveryHandle = {
    commit: () => Promise<void>
    rollback: () => Promise<void>
}
export type NativeRecovery = {
    recoveryDirectory: string
    token: string
    proof: {
        root: { dev: string; ino: string }
        recovery: { dev: string; ino: string }
        journal: { dev: string; ino: string }
    }
}
export type NativeRecoveryProgress = {
    processedEntries: number
    totalEntries: number
}
type StorageRecoveryProgress = (
    processedEntries: number,
    totalEntries: number,
) => void
export type PrepareStorageRecoveryInput = {
    restoredStoragePath: string
    storageRoot: string
    onProgress?: StorageRecoveryProgress
}
export type PrepareBackgroundStorageRecoveryInput = {
    restoredStoragePath: string
    storageRoot: string
    restoredRelativeFilePaths: string[]
    originalEntries: BackgroundStorageEntry[]
    completeSnapshot: boolean
}
export type StorageRecoveryCapacityRequest = {
    directoryPath: string
    sourcePaths: readonly string[]
    additionalBytes?: bigint
}
