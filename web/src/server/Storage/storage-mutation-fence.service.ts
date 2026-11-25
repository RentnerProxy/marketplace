import path from 'node:path'
import { z } from 'zod'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { coreSuccessSchema } from '@/server/Core/protocol.ts'
import {
    nativeStorageAbsolutePathSchema,
    nativeStorageIdentitySchema,
} from './private-paths.service.ts'
import {
    StorageMutationAdmissionBusyError,
    StorageMutationFenceUnavailableError,
} from './storage-mutation-fence.errors.ts'
import type {
    StorageMutationExclusiveFenceInput,
    StorageMutationFenceLease,
    StorageMutationSharedFenceInput,
} from './Types/storage-mutation-fence.types.ts'

const metadataSchema = z
    .object({
        version: z.literal(config.version),
        kind: z.enum(['shared', 'exclusive']),
        owner: z
            .string()
            .regex(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ),
    })
    .strict()
const directorySchema = z
    .object({
        path: nativeStorageAbsolutePathSchema,
        identity: nativeStorageIdentitySchema,
    })
    .strict()
const leaseSchema = z
    .object({
        context: z
            .object({
                rootDirectory: nativeStorageAbsolutePathSchema,
                sharedDirectory: nativeStorageAbsolutePathSchema,
                directories: z.tuple([directorySchema, directorySchema]),
            })
            .strict(),
        file: z
            .object({
                path: nativeStorageAbsolutePathSchema,
                identity: nativeStorageIdentitySchema,
                metadata: metadataSchema,
            })
            .strict(),
    })
    .strict()
    .superRefine(function (lease, context) {
        const root = lease.context.rootDirectory
        const shared = path.join(root, config.sharedDirectoryName)
        const expectedFile =
            lease.file.metadata.kind === 'shared'
                ? path.join(shared, lease.file.metadata.owner + '.json')
                : path.join(root, config.exclusiveFileName)
        if (
            lease.context.sharedDirectory !== shared ||
            lease.context.directories[0].path !== root ||
            lease.context.directories[1].path !== shared ||
            lease.file.path !== expectedFile
        )
            context.addIssue({
                code: 'custom',
                message: 'Invalid storage fence lease.',
            })
    })

function validateSuccessResult(value: unknown) {
    return coreSuccessSchema.parse(value)
}

function nativeLease(lease: StorageMutationFenceLease) {
    return {
        context: {
            ...lease.context,
            directories: lease.context.directories.map(function (directory) {
                return {
                    path: directory.path,
                    identity: {
                        dev: String(directory.identity.dev),
                        ino: String(directory.identity.ino),
                    },
                }
            }),
        },
        file: {
            ...lease.file,
            identity: {
                dev: String(lease.file.identity.dev),
                ino: String(lease.file.identity.ino),
            },
        },
    }
}
function readLease(
    value: unknown,
    rootDirectory: string,
    kind: 'shared' | 'exclusive',
): StorageMutationFenceLease {
    const lease = leaseSchema.parse(value)
    if (
        lease.context.rootDirectory !== path.resolve(rootDirectory) ||
        lease.file.metadata.kind !== kind
    )
        throw new StorageMutationFenceUnavailableError()
    return {
        context: {
            ...lease.context,
            directories: lease.context.directories.map(function (directory) {
                return {
                    path: directory.path,
                    identity: {
                        dev: BigInt(directory.identity.dev),
                        ino: BigInt(directory.identity.ino),
                    },
                }
            }),
        },
        file: {
            ...lease.file,
            identity: {
                dev: BigInt(lease.file.identity.dev),
                ino: BigInt(lease.file.identity.ino),
            },
        },
    }
}
function failure(error: unknown, allowBusy = false): never {
    if (
        allowBusy &&
        error instanceof CoreCommandError &&
        !error.isUncertain &&
        (error.code === 'STORAGE_MUTATION_ADMISSION_BUSY' ||
            error.code === 'CORE_BUSY')
    )
        throw new StorageMutationAdmissionBusyError()
    throw new StorageMutationFenceUnavailableError()
}

export async function admitSharedStorageMutationFenceService(
    input: StorageMutationSharedFenceInput,
): Promise<StorageMutationFenceLease> {
    try {
        const current = input.currentLease
            ? leaseSchema.parse(nativeLease(input.currentLease))
            : undefined
        const lease = await runCoreCommandService(
            'storage',
            {
                operation: 'fenceAdmitShared',
                rootDirectory: input.rootDirectory,
                ...(current ? { currentLease: current } : {}),
            },
            {
                validateResult(value) {
                    return readLease(value, input.rootDirectory, 'shared')
                },
            },
        )
        if (input.currentLease) {
            if (
                JSON.stringify(nativeLease(lease)) !==
                JSON.stringify(nativeLease(input.currentLease))
            )
                throw new StorageMutationFenceUnavailableError()
            return input.currentLease
        }
        return lease
    } catch (error) {
        return failure(error, true)
    }
}

export async function acquireExclusiveStorageMutationFenceService(
    input: StorageMutationExclusiveFenceInput,
): Promise<StorageMutationFenceLease | null> {
    try {
        return await runCoreCommandService(
            'storage',
            { operation: 'fenceAcquireExclusive', ...input },
            {
                validateResult(value) {
                    if (value === null && input.tryOnly) return null
                    return readLease(value, input.rootDirectory, 'exclusive')
                },
            },
        )
    } catch (error) {
        return failure(error, true)
    }
}

export async function releaseStorageMutationFenceService(
    lease: StorageMutationFenceLease,
): Promise<void> {
    try {
        const request = {
            operation: 'fenceRelease',
            lease: leaseSchema.parse(nativeLease(lease)),
        }
        try {
            await runCoreCommandService('storage', request, {
                validateResult: validateSuccessResult,
            })
        } catch (error) {
            if (
                !(error instanceof CoreCommandError) ||
                error.isUncertain ||
                error.code !== 'CORE_BUSY'
            )
                throw error
            // CORE_BUSY is returned before admission. Release remains possible
            // even when unrelated work has filled the storage worker queue.
            await runCoreCommandService('storage', request, {
                validateResult: validateSuccessResult,
                environment: {},
            })
        }
    } catch (error) {
        failure(error)
    }
}

export async function waitForStorageMutationSharedDrainService(
    lease: StorageMutationFenceLease,
): Promise<void> {
    try {
        const native = leaseSchema.parse(nativeLease(lease))
        if (native.file.metadata.kind !== 'exclusive')
            throw new StorageMutationFenceUnavailableError()
        await runCoreCommandService(
            'storage',
            { operation: 'fenceDrain', lease: native },
            {
                validateResult: validateSuccessResult,
            },
        )
    } catch (error) {
        failure(error)
    }
}
