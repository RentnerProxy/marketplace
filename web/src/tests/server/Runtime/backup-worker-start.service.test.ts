import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import {
    closeBackgroundWorkersService,
    createBackupWorkerStartCoordinatorService,
} from '@/server/Runtime/backup-worker-start.service.ts'

describe('Dynamischer Backup-Worker-Start', function () {
    const worker = {
        close: vi.fn(async function () {}),
        isRunning: vi.fn(function () {
            return true
        }),
    }
    let restoreQuiescenceIsActive = false
    const startBackupWorker = vi.fn(async function () {
        return worker
    })

    beforeEach(function () {
        vi.clearAllMocks()
        restoreQuiescenceIsActive = false
    })

    it('startet nach einer später freigegebenen Restore-Quiesce ohne Prozessneustart', async function () {
        restoreQuiescenceIsActive = true
        const coordinator = createBackupWorkerStartCoordinatorService({
            isRestoreQuiescenceActive: async () => restoreQuiescenceIsActive,
            startBackupWorker,
        })

        await expect(coordinator.startWhenAvailable()).resolves.toBeNull()
        expect(startBackupWorker).not.toHaveBeenCalled()

        restoreQuiescenceIsActive = false

        await expect(coordinator.startWhenAvailable()).resolves.toBe(worker)
        expect(startBackupWorker).toHaveBeenCalledTimes(1)
        expect(coordinator.getWorker()).toBe(worker)
    })

    it('startet bei konkurrierenden Healthchecks nur einen Backup-Worker', async function () {
        const coordinator = createBackupWorkerStartCoordinatorService({
            isRestoreQuiescenceActive: async () => false,
            startBackupWorker,
        })

        await expect(
            Promise.all([
                coordinator.startWhenAvailable(),
                coordinator.startWhenAvailable(),
            ]),
        ).resolves.toEqual([worker, worker])
        expect(startBackupWorker).toHaveBeenCalledTimes(1)
    })

    it('startet nach dem Shutdown keinen verzögerten Worker, auch wenn der Restore später freigegeben wird', async function () {
        const quiescence = Promise.withResolvers<boolean>()
        const coordinator = createBackupWorkerStartCoordinatorService({
            isRestoreQuiescenceActive: () => quiescence.promise,
            startBackupWorker,
        })
        const starting = coordinator.startWhenAvailable()
        const stopping = coordinator.stop()
        quiescence.resolve(false)
        await expect(starting).resolves.toBeNull()
        await expect(stopping).resolves.toBeNull()
        await expect(coordinator.startWhenAvailable()).resolves.toBeNull()
        expect(startBackupWorker).not.toHaveBeenCalled()
    })

    it('übernimmt einen bereits begonnenen Worker-Start für den anschließenden Shutdown', async function () {
        const workerStarted = Promise.withResolvers<typeof worker>()
        startBackupWorker.mockReturnValueOnce(workerStarted.promise)
        const coordinator = createBackupWorkerStartCoordinatorService({
            isRestoreQuiescenceActive: async () => false,
            startBackupWorker,
        })
        const starting = coordinator.startWhenAvailable()
        await waitForAssertion(() =>
            expect(startBackupWorker).toHaveBeenCalledTimes(1),
        )
        const stopping = coordinator.stop()
        workerStarted.resolve(worker)
        await expect(starting).resolves.toBe(worker)
        await expect(stopping).resolves.toBe(worker)
        expect(coordinator.getWorker()).toBe(worker)
    })

    it('behandelt einen Start-Race mit neu aktivierter Restore-Quiesce als Pause', async function () {
        const startError = new Error('restore started during worker startup')
        startBackupWorker.mockImplementationOnce(async function () {
            restoreQuiescenceIsActive = true
            throw startError
        })
        const coordinator = createBackupWorkerStartCoordinatorService({
            isRestoreQuiescenceActive: async () => restoreQuiescenceIsActive,
            startBackupWorker,
        })

        await expect(coordinator.startWhenAvailable()).resolves.toBeNull()
        expect(coordinator.getWorker()).toBeNull()
    })

    it('drainiert den Backup-Worker vor Mail-Worker und Restore-Quiesce', async function () {
        const closeOrder: Array<string> = []
        let finishBackupClose: (() => void) | undefined
        const backupCloseFinished = new Promise<void>(function (resolve) {
            finishBackupClose = resolve
        })
        const activeBackupWorker = {
            close: vi.fn(async function () {
                closeOrder.push('backup-close-started')
                await backupCloseFinished
                closeOrder.push('backup-close-finished')
            }),
            isRunning: vi.fn(function () {
                return true
            }),
        }
        const closeMailWorker = vi.fn(async function () {
            closeOrder.push('mail-and-quiescence-closed')
        })

        const shutdown = closeBackgroundWorkersService({
            backupWorker: activeBackupWorker,
            closeMailWorker,
        })

        await waitForAssertion(function () {
            expect(activeBackupWorker.close).toHaveBeenCalledTimes(1)
        })
        expect(closeMailWorker).not.toHaveBeenCalled()

        finishBackupClose?.()
        await shutdown

        expect(closeOrder).toEqual([
            'backup-close-started',
            'backup-close-finished',
            'mail-and-quiescence-closed',
        ])
    })

    it('schließt auch nach einem Backup-Closefehler den Mail-Worker', async function () {
        const closeError = new Error('Synthetic backup close failure')
        const closeMailWorker = vi.fn(async function () {})
        await expect(
            closeBackgroundWorkersService({
                backupWorker: {
                    close: async function () {
                        throw closeError
                    },
                    isRunning: () => false,
                },
                closeMailWorker,
            }),
        ).rejects.toBe(closeError)
        expect(closeMailWorker).toHaveBeenCalledTimes(1)
    })
})
