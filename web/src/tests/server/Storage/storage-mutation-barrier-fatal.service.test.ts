import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    barrierMocks,
    resetStorageMutationBarrierTestHarness,
} from './storageMutationBarrier.testHarness.ts'

const {
    StorageMutationBarrierUnavailableError,
    withExclusiveStorageMutationBarrier,
    withSharedStorageMutationBarrier,
} = await import('@/server/Storage/storage-mutation-barrier.service.ts')
const {
    isStorageMutationBarrierHealthyService,
    setStorageMutationBarrierFatalFailureHandlerService,
} = await import('@/server/Storage/storage-mutation-barrier-health.service.ts')

describe('Storage-Mutations-Barrier Fail-closed', function () {
    beforeEach(resetStorageMutationBarrierTestHarness)

    it('meldet einen fehlgeschlagenen exklusiven Verbindungs-Discard dauerhaft fail-closed', async function () {
        if (!isStorageMutationBarrierHealthyService()) {
            await expect(
                withSharedStorageMutationBarrier(async function () {}),
            ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
            await expect(
                withExclusiveStorageMutationBarrier(async function () {}),
            ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
            expect(barrierMocks.reserve).not.toHaveBeenCalled()
            return
        }

        const operationError = new Error('restore rollback required')
        const fatalFailureHandler = vi.fn()
        setStorageMutationBarrierFatalFailureHandlerService(fatalFailureHandler)
        barrierMocks.failures.unlockExclusive = true
        barrierMocks.failures.closeConnection = true

        let barrierError: unknown

        try {
            await withExclusiveStorageMutationBarrier(async function () {
                throw operationError
            })
        } catch (error) {
            barrierError = error
        }

        expect(barrierError).toMatchObject({
            name: 'AggregateError',
            errors: expect.arrayContaining([operationError]),
        })
        expect(barrierMocks.close).toHaveBeenCalledTimes(1)
        expect(barrierMocks.release).not.toHaveBeenCalled()
        expect(isStorageMutationBarrierHealthyService()).toBe(false)
        expect(fatalFailureHandler).toHaveBeenCalledTimes(1)

        vi.clearAllMocks()
        await expect(
            withSharedStorageMutationBarrier(async function () {}),
        ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
        await expect(
            withExclusiveStorageMutationBarrier(async function () {}),
        ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
        expect(barrierMocks.reserve).not.toHaveBeenCalled()
    })
})
