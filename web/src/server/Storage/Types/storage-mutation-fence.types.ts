import type {
    PrivateStorageDirectorySnapshot,
    PrivateStorageFileIdentity,
} from './private-files.types.ts'

type StorageMutationFenceMetadata = {
    version: 1
    kind: 'shared' | 'exclusive'
    owner: string
}

type StorageMutationFenceContext = {
    rootDirectory: string
    sharedDirectory: string
    directories: PrivateStorageDirectorySnapshot[]
}

type StorageMutationFenceOwnedFile = {
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
