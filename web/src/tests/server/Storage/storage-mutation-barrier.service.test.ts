import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    barrierMocks,
    resetStorageMutationBarrierTestHarness,
} from '@/tests/server/Storage/storageMutationBarrier.testHarness.ts'

const {
    RestoreInProgressError,
    tryWithExclusiveStorageMutationBarrier,
    withExclusiveStorageMutationBarrier,
    withSharedStorageMutationBarrier,
} = await import('@/server/Storage/storage-mutation-barrier.service.ts')

describe('Storage-Mutations-Barrier', function () {
    beforeEach(resetStorageMutationBarrierTestHarness)

    it('hält einen reservierten Shared-Session-Lock bis zum Ende der Operation', async function () {
        await expect(
            withSharedStorageMutationBarrier(async function () {
                barrierMocks.events.push('operation')
                return 'result'
            }),
        ).resolves.toBe('result')

        expect(barrierMocks.events).toEqual([
            'connection:reserve',
            'query:select pg_catalog.pg_try_advisory_lock_shared( pg_catalog.hashtext(?) ) as acquired',
            'operation',
            'query:select pg_catalog.pg_advisory_unlock_shared( pg_catalog.hashtext(?) ) as unlocked',
            'connection:release',
        ])
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

    it('weist neue Mutationen nach gesetztem Restore-Marker vor dem Lock ab', async function () {
        barrierMocks.isRestoreActive.mockResolvedValue(true)

        await expect(
            withSharedStorageMutationBarrier(async function () {}),
        ).rejects.toBeInstanceOf(RestoreInProgressError)
        expect(barrierMocks.reserve).not.toHaveBeenCalled()
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
