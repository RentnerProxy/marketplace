export type PrivateStorageFileWriteInput = {
    rootDirectory: string
    filePath: string
    data: Uint8Array
}

export type PrivateStorageFileIdentity = {
    dev: bigint
    ino: bigint
}

export type PrivateStorageDirectorySnapshot = {
    path: string
    identity: PrivateStorageFileIdentity
}

export type NativeDirectorySnapshot = {
    path: string
    identity: { dev: string; ino: string }
}
