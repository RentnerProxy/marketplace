import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { RestoreRollbackError } from './archive-restore.errors.ts'
import path from 'node:path'
import { z } from 'zod'
import {
    nativeStorageAbsolutePathSchema,
    nativeStorageIdentitySchema,
} from '@/server/Storage/private-paths.service.ts'
import type {
    StorageRecoveryHandle,
    StorageRecoveryCapacityRequest,
    PrepareStorageRecoveryInput,
    PrepareBackgroundStorageRecoveryInput,
    NativeRecovery,
    NativeRecoveryProgress,
} from './Types/archive-storage-recovery.types.ts'

const nativeRecoverySchema = z
    .object({
        recoveryDirectory: nativeStorageAbsolutePathSchema,
        token: z
            .string()
            .regex(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ),
        proof: z
            .object({
                root: nativeStorageIdentitySchema,
                recovery: nativeStorageIdentitySchema,
                journal: nativeStorageIdentitySchema,
            })
            .strict(),
    })
    .strict()

function isNativeRecoveryProgress(
    progress: unknown,
): progress is NativeRecoveryProgress {
    return (
        typeof progress === 'object' &&
        progress !== null &&
        'processedEntries' in progress &&
        typeof progress.processedEntries === 'number' &&
        Number.isSafeInteger(progress.processedEntries) &&
        progress.processedEntries >= 0 &&
        'totalEntries' in progress &&
        typeof progress.totalEntries === 'number' &&
        Number.isSafeInteger(progress.totalEntries) &&
        progress.totalEntries >= progress.processedEntries
    )
}

export async function syncRestoredStorageTree(directoryPath: string) {
    await runCoreCommandService('storage', {
        operation: 'syncTree',
        path: directoryPath,
        // Archive extraction has already synced regular files.
        directoriesOnly: true,
    })
}

async function prepareRecovery(
    request: Record<string, unknown>,
    onProgress?: PrepareStorageRecoveryInput['onProgress'],
): Promise<StorageRecoveryHandle> {
    let recovery: NativeRecovery
    try {
        recovery = await runCoreCommandService<NativeRecovery>(
            'storage',
            {
                operation: 'recoveryPrepare',
                ...request,
            },
            {
                timeoutMs: 60 * 60 * 1000,
                validateResult(result) {
                    const parsedRecovery = nativeRecoverySchema.parse(result)
                    if (
                        typeof request.storageRoot !== 'string' ||
                        path.dirname(parsedRecovery.recoveryDirectory) !==
                            path.dirname(path.resolve(request.storageRoot)) ||
                        path.basename(parsedRecovery.recoveryDirectory) !==
                            `.storage-before-${parsedRecovery.token}`
                    )
                        throw new Error(
                            'Der Storage-Core hat einen ungültigen Recovery-Bereich gemeldet.',
                        )
                    return parsedRecovery
                },
                onProgress(progress) {
                    if (!isNativeRecoveryProgress(progress))
                        throw new Error(
                            'Der Storage-Core hat einen ungültigen Fortschritt gemeldet.',
                        )
                    onProgress?.(
                        progress.processedEntries,
                        progress.totalEntries,
                    )
                },
            },
        )
    } catch (error) {
        if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'STORAGE_ROLLBACK_FAILED'
        )
            throw new RestoreRollbackError(error.message, [error], error)
        throw error
    }
    let finished = false
    async function finish(action: 'commit' | 'rollback') {
        if (finished) return
        try {
            await runCoreCommandService(
                'storage',
                {
                    operation: 'recoveryFinish',
                    ...recovery,
                    action,
                },
                { timeoutMs: 60 * 60 * 1000 },
            )
            finished = true
        } catch (error) {
            throw new RestoreRollbackError(
                'Der Storage-Recovery-Abschluss ist fehlgeschlagen. Der Rücksetzpunkt bleibt zur manuellen Rettung erhalten.',
                [error],
                error,
            )
        }
    }
    return {
        commit: async function () {
            await finish('commit')
        },
        rollback: async function () {
            await finish('rollback')
        },
    }
}

export async function prepareStorageRecovery(
    input: PrepareStorageRecoveryInput,
) {
    return prepareRecovery(
        {
            storageRoot: input.storageRoot,
            restoredStoragePath: input.restoredStoragePath,
        },
        input.onProgress,
    )
}

export async function prepareBackgroundStorageRecovery(
    input: PrepareBackgroundStorageRecoveryInput,
) {
    return prepareRecovery({
        private: true,
        storageRoot: input.storageRoot,
        restoredStoragePath: input.restoredStoragePath,
        restoredRelativeFilePaths: input.restoredRelativeFilePaths,
        completeSnapshot: input.completeSnapshot,
        originalEntries: input.originalEntries.map(function (entry) {
            return {
                privateRelativePath: entry.privateRelativePath,
                identity: {
                    dev: entry.identity.dev,
                    ino: entry.identity.ino,
                },
            }
        }),
    })
}

export async function assertStorageRecoveryCapacityService(
    requests: readonly StorageRecoveryCapacityRequest[],
) {
    await runCoreCommandService('storage', {
        operation: 'capacity',
        requests: requests.map(function (request) {
            return {
                ...request,
                additionalBytes: String(request.additionalBytes ?? 0n),
            }
        }),
    })
}
