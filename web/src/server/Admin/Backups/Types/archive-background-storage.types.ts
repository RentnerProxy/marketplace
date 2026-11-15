export type BackgroundStorageLayout = {
    publicRelativeDirectory: string
    privateRelativeDirectory: string
    fileName: string
}

export type BackgroundStorageEntry = {
    absolutePath: string
    privateRelativePath: string
    publicRelativePath: string
    size: number
    identity: { dev: string; ino: string }
}

export type BackgroundStoragePathsInput = {
    storageRoot: string
    privateStorageRoot: string
    protectedPaths: readonly string[]
}

export type CollectBackgroundFilesInput = {
    storageRoot: string
    location: 'public' | 'private'
}

export type PreparedBackgroundStorage = {
    restoredStoragePath: string
    relativeFilePaths: string[]
}
