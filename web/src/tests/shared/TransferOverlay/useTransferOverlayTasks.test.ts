import { afterEach, describe, expect, it, vi, setSystemTime } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import useTransferOverlayTasks, {
    clearTransferTasks,
    dismissTransferTask,
    finishExternalTransferTask,
    startTransferTask,
    syncExternalTransferTask,
} from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'

vi.mock('react', function () {
    return {
        useSyncExternalStore: function (
            subscribe: (subscriber: () => void) => () => void,
            getSnapshot: () => unknown,
        ) {
            subscribe(function () {})
            return getSnapshot()
        },
    }
})

describe('useTransferOverlayTasks', function () {
    afterEach(function () {
        clearTransferTasks()
        vi.useRealTimers()
        restoreTestGlobals()
    })

    it('bildet simulierten und extern gemeldeten Transferfortschritt vollständig ab', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
        stubTestGlobal('window', {
            clearInterval,
            clearTimeout,
            setInterval,
            setTimeout,
        })

        const initialStore = useTransferOverlayTasks()
        expect(initialStore.state.tasks).toEqual([])

        const transfer = startTransferTask({
            direction: 'upload',
            title: 'Test-Upload',
            totalBytes: 100,
        })

        vi.advanceTimersByTime(250)
        transfer.updateProgress({
            totalBytes: 200,
            transferredBytes: 50,
            speedBytesPerSecond: 25,
        })

        expect(useTransferOverlayTasks().state.tasks).toEqual([
            expect.objectContaining({
                id: transfer.id,
                indeterminate: false,
                progress: 25,
                speedBytesPerSecond: 25,
                status: 'running',
                totalBytes: 200,
                transferredBytes: 50,
            }),
        ])

        transfer.complete('Fertig')
        expect(useTransferOverlayTasks().state.tasks[0]).toEqual(
            expect.objectContaining({
                message: 'Fertig',
                progress: 100,
                status: 'success',
                transferredBytes: 200,
            }),
        )

        vi.advanceTimersByTime(3500)
        expect(useTransferOverlayTasks().state.tasks).toEqual([])

        const indeterminateTransfer = startTransferTask({
            direction: 'download',
            title: 'Test-Download',
            totalBytes: 0,
            indeterminate: true,
        })
        vi.advanceTimersByTime(250)
        indeterminateTransfer.fail('Fehlgeschlagen')
        expect(useTransferOverlayTasks().state.tasks[0]).toEqual(
            expect.objectContaining({
                message: 'Fehlgeschlagen',
                status: 'error',
                totalBytes: 1,
            }),
        )
        indeterminateTransfer.dismiss()

        const dismissedByHelper = startTransferTask({
            direction: 'upload',
            title: 'Direkt entfernen',
            totalBytes: 10,
        })
        dismissTransferTask(dismissedByHelper.id)

        const dismissedByHook = startTransferTask({
            direction: 'download',
            title: 'Über Hook entfernen',
            totalBytes: 10,
        })
        useTransferOverlayTasks().handler.handleDismissTask(dismissedByHook.id)

        const dismissedByController = startTransferTask({
            direction: 'download',
            title: 'Über Controller entfernen',
            totalBytes: 10,
        })
        dismissedByController.dismiss()

        expect(useTransferOverlayTasks().state.tasks).toEqual([])
    })

    it('synchronisiert externe Backup-Tasks idempotent und schützt laufende Tasks vor dem Schließen', function () {
        vi.useFakeTimers()
        stubTestGlobal('window', {
            clearInterval,
            clearTimeout,
            setInterval,
            setTimeout,
        })
        const taskInput = {
            id: 'backup-creation:019f5b07-80e2-7000-8000-000000000001',
            direction: 'download' as const,
            kind: 'backup' as const,
            title: 'Manuelles Backup',
            totalBytes: 200,
            transferredBytes: 50,
            speedBytesPerSecond: 25,
            message: 'Daten werden gesichert',
        }

        syncExternalTransferTask(taskInput)
        syncExternalTransferTask(taskInput)

        expect(useTransferOverlayTasks().state.tasks).toEqual([
            expect.objectContaining({
                id: taskInput.id,
                kind: 'backup',
                progress: 25,
                status: 'running',
            }),
        ])

        dismissTransferTask(taskInput.id)
        expect(useTransferOverlayTasks().state.tasks).toHaveLength(1)

        finishExternalTransferTask({
            ...taskInput,
            transferredBytes: 200,
            status: 'success',
            message: 'Backup vollständig gesichert',
        })
        finishExternalTransferTask({
            ...taskInput,
            transferredBytes: 200,
            status: 'success',
            message: 'Backup vollständig gesichert',
        })

        expect(useTransferOverlayTasks().state.tasks).toEqual([
            expect.objectContaining({
                id: taskInput.id,
                progress: 100,
                status: 'success',
                transferredBytes: 200,
            }),
        ])

        vi.advanceTimersByTime(3_500)
        expect(useTransferOverlayTasks().state.tasks).toEqual([])
    })

    it('startet für unbestimmten Fortschritt kein Leerlauf-Intervall', function () {
        vi.useFakeTimers()
        const setIntervalSpy = vi.fn(setInterval)
        stubTestGlobal('window', {
            clearInterval,
            clearTimeout,
            setInterval: setIntervalSpy,
            setTimeout,
        })

        const transfer = startTransferTask({
            direction: 'download',
            title: 'Vorbereitung',
            totalBytes: 0,
            indeterminate: true,
        })

        expect(setIntervalSpy).not.toHaveBeenCalled()
        transfer.fail('Fehlgeschlagen')
    })
})
