import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { NativeRecovery } from '@/server/Admin/Backups/Types/archive-storage-recovery.types.ts'
import type { CoreCommandOptions } from '@/server/Core/Types/core.types.ts'
import path from 'node:path'

const recovery: NativeRecovery = {
    recoveryDirectory: path.resolve(
        '/synthetic/.storage-before-00000000-0000-4000-8000-000000000040',
    ),
    token: '00000000-0000-4000-8000-000000000040',
    proof: {
        root: { dev: '1', ino: '2' },
        recovery: { dev: '1', ino: '3' },
        journal: { dev: '1', ino: '4' },
    },
}
const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: CoreCommandOptions,
): Promise<unknown> {
    return recovery
})
vi.mock('@/server/Core/command.service.ts', function () {
    return { runCoreCommandService: command }
})
import {
    prepareStorageRecovery,
    prepareBackgroundStorageRecovery,
    assertStorageRecoveryCapacityService,
    syncRestoredStorageTree,
} from '@/server/Admin/Backups/archive-storage-recovery.service.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'

beforeEach(function () {
    command.mockReset()
    command.mockResolvedValue(recovery)
})

describe('native storage recovery coordination', function () {
    it('validiert Recovery-Pfade, Token und alle unveränderten Identitätsbelege', async function () {
        await prepareStorageRecovery({
            storageRoot: '/synthetic/storage',
            restoredStoragePath: '/synthetic/restored',
        })
        const validate = command.mock.calls[0]?.[2]?.validateResult
        if (!validate) throw new Error('Missing result validator')
        expect(validate(recovery)).toEqual(recovery)
        for (const result of [
            { ...recovery, extra: true },
            { ...recovery, token: 'invalid' },
            { ...recovery, recoveryDirectory: path.resolve('/outside') },
            { ...recovery, proof: { ...recovery.proof, extra: true } },
            {
                ...recovery,
                proof: { ...recovery.proof, root: { dev: '1', ino: '-1' } },
            },
            { ...recovery, proof: undefined },
        ]) {
            expect(function () {
                validate(result)
            }).toThrow()
        }
    })
    it('retains prepare-time identities and commits the native recovery once', async function () {
        const progress = vi.fn()
        const handle = await prepareStorageRecovery({
            storageRoot: '/synthetic/storage',
            restoredStoragePath: '/synthetic/restored',
            onProgress: progress,
        })
        command.mock.calls[0]?.[2]?.onProgress?.({
            processedEntries: 2,
            totalEntries: 3,
        })
        expect(progress).toHaveBeenCalledWith(2, 3)
        await handle.commit()
        await handle.commit()
        await handle.rollback()
        expect(command).toHaveBeenCalledTimes(2)
        expect(command.mock.calls[1]?.[1]).toEqual({
            operation: 'recoveryFinish',
            ...recovery,
            action: 'commit',
        })
    })

    it('keeps a failed rollback retryable and reports recovery errors explicitly', async function () {
        const handle = await prepareStorageRecovery({
            storageRoot: '/synthetic/storage',
            restoredStoragePath: '/synthetic/restored',
        })
        command.mockRejectedValueOnce(new Error('synthetic rollback failure'))
        await expect(handle.rollback()).rejects.toBeInstanceOf(
            RestoreRollbackError,
        )
        await handle.rollback()
        await handle.commit()
        expect(command).toHaveBeenCalledTimes(3)
    })

    it('preserves incomplete physical rollback errors for fail-closed orchestration', async function () {
        command.mockRejectedValue(
            Object.assign(new Error('synthetic rollback failure'), {
                code: 'STORAGE_ROLLBACK_FAILED',
            }),
        )
        await expect(
            prepareStorageRecovery({
                storageRoot: '/synthetic/storage',
                restoredStoragePath: '/synthetic/restored',
            }),
        ).rejects.toBeInstanceOf(RestoreRollbackError)
        command.mockRejectedValue(new Error('synthetic preparation failure'))
        await expect(
            prepareStorageRecovery({
                storageRoot: '/synthetic/storage',
                restoredStoragePath: '/synthetic/restored',
            }),
        ).rejects.toThrow('synthetic preparation failure')
    })

    it('rejects malformed progress instead of accepting an untyped payload', async function () {
        await prepareStorageRecovery({
            storageRoot: '/synthetic/storage',
            restoredStoragePath: '/synthetic/restored',
        })
        expect(function () {
            command.mock.calls[0]?.[2]?.onProgress?.({
                processedEntries: -1,
                totalEntries: 2,
            })
        }).toThrow()
    })

    it('serializes capacities without losing bigint precision and delegates tree sync', async function () {
        await assertStorageRecoveryCapacityService([
            {
                directoryPath: '/synthetic/storage',
                sourcePaths: ['/synthetic/source'],
                additionalBytes: 9007199254740993n,
            },
        ])
        expect(command.mock.calls[0]?.[1]).toEqual({
            operation: 'capacity',
            requests: [
                {
                    directoryPath: '/synthetic/storage',
                    sourcePaths: ['/synthetic/source'],
                    additionalBytes: '9007199254740993',
                },
            ],
        })
        await syncRestoredStorageTree('/synthetic/restored')
        expect(command.mock.calls[1]?.[1]).toEqual({
            operation: 'syncTree',
            path: '/synthetic/restored',
            directoriesOnly: true,
        })
    })

    it('preserves private snapshot scope and identities in the native request', async function () {
        await prepareBackgroundStorageRecovery({
            storageRoot: '/synthetic/private',
            restoredStoragePath: '/synthetic/restored',
            completeSnapshot: false,
            restoredRelativeFilePaths: ['user/background.webp'],
            originalEntries: [],
        })
        expect(command.mock.calls[0]?.[1]).toEqual({
            operation: 'recoveryPrepare',
            private: true,
            storageRoot: '/synthetic/private',
            restoredStoragePath: '/synthetic/restored',
            completeSnapshot: false,
            restoredRelativeFilePaths: ['user/background.webp'],
            originalEntries: [],
        })
    })
})
