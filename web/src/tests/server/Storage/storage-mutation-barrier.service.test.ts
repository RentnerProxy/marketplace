import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import {
    barrierMocks,
    fenceMocks,
    fenceRoot,
    resetStorageMutationBarrierTestHarness,
} from '@/tests/server/Storage/storageMutationBarrier.testHarness.ts'

const {
    drainSharedStorageMutationBarrierService: drainShared,
    RestoreInProgressError,
    StorageMutationBarrierUnavailableError,
    tryWithExclusiveStorageMutationBarrier,
    withExclusiveStorageMutationBarrier,
    withSharedStorageMutationBarrier,
} = await import('@/server/Storage/storage-mutation-barrier.service.ts')
const barrierHealth =
    await import('@/server/Storage/storage-mutation-barrier-health.service.ts')

async function pauseIdleFenceRelease() {
    vi.useFakeTimers()
    const releasing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    fenceMocks.release.mockImplementationOnce(function () {
        releasing.resolve()
        return release.promise
    })
    await withSharedStorageMutationBarrier(() => undefined)
    vi.advanceTimersByTime(config.sharedIdleHoldMs)
    await releasing.promise
    return release
}

describe('Storage-Mutations-Barrier', function () {
    beforeEach(resetStorageMutationBarrierTestHarness)
    afterEach(async () => {
        try {
            await drainShared()
        } finally {
            vi.useRealTimers()
        }
    })

    it('keeps a shared SQL session through the operation and releases it on drain', async function () {
        await expect(
            withSharedStorageMutationBarrier(async function () {
                barrierMocks.events.push('operation')
                return 'result'
            }),
        ).resolves.toBe('result')

        expect(barrierMocks.release).not.toHaveBeenCalled()
        await drainShared()
        expect(barrierMocks.events).toEqual([
            'connection:reserve',
            'query:select pg_catalog.pg_try_advisory_lock_shared( pg_catalog.hashtext(?) ) as acquired',
            'operation',
            'query:select pg_catalog.pg_advisory_unlock_shared( pg_catalog.hashtext(?) ) as unlocked',
            'connection:release',
        ])
    })

    it('drains an active operation and waits for its persistent fence to be released', async function () {
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const releasing = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        fenceMocks.release.mockImplementationOnce(async function () {
            releasing.resolve()
            await released.promise
        })
        const operation = withSharedStorageMutationBarrier(async function () {
            started.resolve()
            await finish.promise
        })
        await started.promise

        let drained = false
        const closing = drainShared().then(() => {
            drained = true
            return undefined
        })
        try {
            finish.resolve()
            await releasing.promise
            expect(drained).toBe(false)
        } finally {
            released.resolve()
            await Promise.all([operation, closing])
        }
        expect(drained).toBe(true)
    })

    it('reuses an idle lease until the hold after the most recent operation expires', async function () {
        vi.useFakeTimers()
        const released = Promise.withResolvers<void>()
        fenceMocks.release.mockImplementationOnce(async () =>
            released.resolve(),
        )
        await withSharedStorageMutationBarrier(() => undefined)
        vi.advanceTimersByTime(config.sharedIdleHoldMs - 1)
        await withSharedStorageMutationBarrier(() => undefined)
        expect(barrierMocks.reserve).toHaveBeenCalledTimes(1)
        expect(
            fenceMocks.admitShared.mock.calls[1]?.[0].currentLease,
        ).toBeDefined()
        vi.advanceTimersByTime(config.sharedIdleHoldMs - 1)
        expect(fenceMocks.release).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        await released.promise
        expect(fenceMocks.release).toHaveBeenCalledTimes(1)
    })

    it('releases a held shared lease before acquiring a local exclusive fence', async function () {
        await withSharedStorageMutationBarrier(() => undefined)
        expect(barrierMocks.release).not.toHaveBeenCalled()
        await tryWithExclusiveStorageMutationBarrier(() => {
            expect(barrierMocks.release).toHaveBeenCalledTimes(1)
        })
    })

    it('waits for an in-flight idle fence release before trying exclusive admission', async function () {
        const release = await pauseIdleFenceRelease()
        vi.useRealTimers()
        const admission = tryWithExclusiveStorageMutationBarrier(
            () => 'reconciled',
        )
        try {
            await setImmediate()
            expect(fenceMocks.acquireExclusive).not.toHaveBeenCalled()
        } finally {
            release.resolve()
            await admission
        }
        await expect(admission).resolves.toEqual({
            acquired: true,
            result: 'reconciled',
        })
    })

    it('rejects shutdown drain if a concurrent idle fence release fails', async function () {
        const isHealthy = vi.spyOn(
            barrierHealth,
            'isStorageMutationBarrierHealthyService',
        )
        const markUnhealthy = vi
            .spyOn(barrierHealth, 'markStorageMutationBarrierUnhealthyService')
            .mockImplementation(() => {
                isHealthy.mockReturnValue(false)
            })
        try {
            const release = await pauseIdleFenceRelease()
            const closing = drainShared()
            const error = new Error('Idle fence release failed.')
            release.reject(error)
            await expect(closing).rejects.toBeInstanceOf(
                StorageMutationBarrierUnavailableError,
            )
            expect(markUnhealthy).toHaveBeenCalledWith(error)
        } finally {
            markUnhealthy.mockRestore()
            isHealthy.mockRestore()
        }
    })

    it('releases an idle lease as soon as another process publishes an exclusive marker', async function () {
        vi.useFakeTimers()
        const released = Promise.withResolvers<void>()
        fenceMocks.release.mockImplementationOnce(async () =>
            released.resolve(),
        )
        await withSharedStorageMutationBarrier(() => undefined)
        const marker = path.join(fenceRoot, config.exclusiveFileName)
        await writeFile(marker, '{}')
        try {
            await released.promise
            expect(barrierMocks.release).toHaveBeenCalledTimes(1)
        } finally {
            await unlink(marker)
        }
    })

    it('verwendet für den Restore einen reservierten exklusiven Session-Lock', async function () {
        await withExclusiveStorageMutationBarrier(async function () {
            barrierMocks.events.push('operation')
        })

        expect(barrierMocks.events).toEqual([
            'connection:reserve',
            'query:select pg_catalog.pg_advisory_lock( pg_catalog.hashtext(?) )',
            'operation',
            'query:select pg_catalog.pg_advisory_unlock( pg_catalog.hashtext(?) ) as unlocked',
            'connection:release',
        ])
    })

    it('führt Startup-Reconciliation nur unter nachweislich freiem exklusivem Try-Lock aus', async function () {
        await expect(
            tryWithExclusiveStorageMutationBarrier(async function () {
                barrierMocks.events.push('reconcile')
                return 'reconciled'
            }),
        ).resolves.toEqual({ acquired: true, result: 'reconciled' })

        expect(barrierMocks.events).toEqual([
            'connection:reserve',
            'query:select pg_catalog.pg_try_advisory_lock( pg_catalog.hashtext(?) ) as acquired',
            'reconcile',
            'query:select pg_catalog.pg_advisory_unlock( pg_catalog.hashtext(?) ) as unlocked',
            'connection:release',
        ])
    })

    it('überspringt Startup-Reconciliation, wenn ein legitimer Restore den exklusiven Lock hält', async function () {
        barrierMocks.failures.tryExclusiveUnavailable = true
        const operation = vi.fn(async function () {})

        await expect(
            tryWithExclusiveStorageMutationBarrier(operation),
        ).resolves.toEqual({ acquired: false })

        expect(operation).not.toHaveBeenCalled()
        expect(barrierMocks.release).toHaveBeenCalledTimes(1)
        expect(barrierMocks.close).not.toHaveBeenCalled()
    })

    it('verwendet für verschachtelte gekoppelte Operationen denselben Shared-Lock', async function () {
        await withSharedStorageMutationBarrier(async function () {
            barrierMocks.events.push('outer')
            await withSharedStorageMutationBarrier(async function () {
                barrierMocks.events.push('inner')
            })
        })

        expect(barrierMocks.reserve).toHaveBeenCalledTimes(1)
        expect(barrierMocks.events).toContain('outer')
        expect(barrierMocks.events).toContain('inner')
        expect(
            barrierMocks.events.filter((event) =>
                event.includes('pg_try_advisory_lock_shared'),
            ),
        ).toHaveLength(1)
    })

    it('pins a shared lease during revalidation and admits independent readers in parallel', async function () {
        const firstStarted = Promise.withResolvers<void>()
        const finishFirst = Promise.withResolvers<void>()
        const revalidationStarted = Promise.withResolvers<void>()
        const confirmRevalidation = Promise.withResolvers<void>()
        const first = withSharedStorageMutationBarrier(async function () {
            firstStarted.resolve()
            await finishFirst.promise
        })
        await firstStarted.promise
        fenceMocks.admitShared.mockImplementationOnce(async function ({
            currentLease,
        }) {
            if (!currentLease)
                throw new Error('The operation lost its shared lease.')
            revalidationStarted.resolve()
            await confirmRevalidation.promise
            return currentLease
        })
        const second = withSharedStorageMutationBarrier(() => 'second')
        try {
            await revalidationStarted.promise
            await expect(
                withSharedStorageMutationBarrier(() => 'third'),
            ).resolves.toBe('third')
            finishFirst.resolve()
            await first
            expect(barrierMocks.reserve).toHaveBeenCalledTimes(1)
            expect(fenceMocks.release).not.toHaveBeenCalled()
        } finally {
            finishFirst.resolve()
            confirmRevalidation.resolve()
            await Promise.allSettled([first, second])
        }
        expect(await second).toBe('second')
        await drainShared()
        expect(fenceMocks.release).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).toHaveBeenCalledTimes(1)
    })

    it('validates the shared root once for each change to the resolved storage paths', async function () {
        const first = {
            backupDirectory: '/backup-cache-test',
            storageDirectory: '/storage-a',
        }
        fenceMocks.backupPaths
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(first)
            .mockReturnValueOnce({ ...first, storageDirectory: '/storage-b' })
        await withSharedStorageMutationBarrier(() => undefined)
        await withSharedStorageMutationBarrier(() => undefined)
        expect(fenceMocks.prepareRoot).toHaveBeenCalledTimes(1)
        await withSharedStorageMutationBarrier(() => undefined)
        expect(fenceMocks.prepareRoot).toHaveBeenCalledTimes(2)
    })

    it('releases an idle lease when the restore state becomes active', async function () {
        await withSharedStorageMutationBarrier(() => undefined)
        barrierMocks.isRestoreActive.mockResolvedValue(true)

        await expect(
            withSharedStorageMutationBarrier(async function () {}),
        ).rejects.toBeInstanceOf(RestoreInProgressError)
        expect(barrierMocks.reserve).toHaveBeenCalledTimes(1)
        expect(fenceMocks.release).toHaveBeenCalledTimes(1)
    })

    it('verwirft eine Verbindung bei einem unbestätigten Shared-Unlock, ohne den Primärfehler zu ersetzen', async function () {
        const operationError = new Error('operation failed')
        barrierMocks.failures.unlockShared = true

        await expect(
            withSharedStorageMutationBarrier(async function () {
                throw operationError
            }),
        ).rejects.toBe(operationError)
        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
    })

    it('verwirft eine Verbindung bei einem unbestätigten exklusiven Unlock, ohne den Primärfehler zu ersetzen', async function () {
        const operationError = new Error('restore rollback required')
        barrierMocks.failures.unlockExclusive = true

        await expect(
            withExclusiveStorageMutationBarrier(async function () {
                throw operationError
            }),
        ).rejects.toBe(operationError)
        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
    })

    it('verwirft den Try-Lock sicher, wenn dessen Unlock nicht bestätigt werden kann', async function () {
        barrierMocks.failures.unlockExclusive = true

        await expect(
            tryWithExclusiveStorageMutationBarrier(async function () {
                return 'reconciled'
            }),
        ).resolves.toEqual({ acquired: true, result: 'reconciled' })

        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
    })

    it('gibt eine Verbindung bei einem negativen Unlock-Ergebnis nicht in den Pool zurück', async function () {
        barrierMocks.failures.unlockExclusiveUnconfirmed = true

        await expect(
            withExclusiveStorageMutationBarrier(async function () {
                return 'restored'
            }),
        ).resolves.toBe('restored')

        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
    })

    it('verwirft eine Verbindung nach einem unklaren Lock-Acquire', async function () {
        barrierMocks.failures.acquireExclusive = true

        await expect(
            withExclusiveStorageMutationBarrier(async function () {}),
        ).rejects.toThrow('exclusive acquire failed')
        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
    })
})
