import type { PrivateStorageFileIdentity } from '@/server/Storage/Types/private-files.types.ts'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { StorageMutationTestDirectory } from './storageMutationFence.test.types.ts'

const ownedDirectories = new Map<string, PrivateStorageFileIdentity>()
const temporaryRoot = path.resolve(tmpdir())
const prefix = 'storage-fence-test-'

export async function createStorageMutationTestDirectoryService(): Promise<StorageMutationTestDirectory> {
    const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, prefix))
    const identity = await lstat(temporaryDirectory, { bigint: true })
    ownedDirectories.set(temporaryDirectory, {
        dev: identity.dev,
        ino: identity.ino,
    })
    return {
        temporaryDirectory,
        rootDirectory: path.join(temporaryDirectory, 'controls'),
    }
}

export async function cleanupStorageMutationTestDirectoryService(
    fixture: StorageMutationTestDirectory,
): Promise<void> {
    const directory = path.resolve(fixture.temporaryDirectory)
    if (
        !ownedDirectories.has(directory) ||
        path.dirname(directory) !== temporaryRoot ||
        !path.basename(directory).startsWith(prefix)
    )
        throw new Error('Unowned test directory.')
    const stats = await lstat(directory, { bigint: true })
    const identity = ownedDirectories.get(directory)
    if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.dev !== identity?.dev ||
        stats.ino !== identity.ino
    )
        throw new Error('Test directory identity changed.')
    await rm(directory, { recursive: true, force: true })
    ownedDirectories.delete(directory)
}
