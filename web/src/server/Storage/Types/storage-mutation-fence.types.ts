import type {
    PrivateStorageDirectorySnapshot,
    PrivateStorageFileIdentity,
} from './private-files.types.ts'

export type StorageMutationFenceKind = 'admission' | 'shared' | 'exclusive'

export type StorageMutationFenceMetadata = {
    version: 1
    kind: StorageMutationFenceKind
    owner: string
}

export type StorageMutationFenceContext = {
    rootDirectory: string
    sharedDirectory: string
    directories: PrivateStorageDirectorySnapshot[]
}

export type StorageMutationFenceOwnedFile = {
    path: string
    identity: PrivateStorageFileIdentity
    metadata: StorageMutationFenceMetadata
}

export type StorageMutationFenceLease = {
    context: StorageMutationFenceContext
    file: StorageMutationFenceOwnedFile
}

export type StorageMutationSharedFenceInput = {
    rootDirectory: string
    currentLease?: StorageMutationFenceLease
}

export type StorageMutationExclusiveFenceInput = {
    rootDirectory: string
    tryOnly: boolean
}
