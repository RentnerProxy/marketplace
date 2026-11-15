import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { BackupRunCreationProgress } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const client = new QueryClient()
const refs: Array<{ current: unknown }> = []
let refCursor = 0
let progress: BackupRunCreationProgress | null = null
let pendingId: string | null = null
let realtime: ((event: RealtimeEvent) => void) | undefined
let browserWindow: EventTarget
let browserDocument: EventTarget & { visibilityState: string }
const mocks = {
    sync: vi.fn(),
    finish: vi.fn(),
    clear: vi.fn(),
    download: vi.fn(),
    error: vi.fn(),
    refetch: vi.fn(async () => {}),
    unsubscribe: vi.fn(),
    clearPending: vi.fn(),
}
vi.mock('react', () => ({
    ...hookReact,
    useCallback: <T>(callback: T) => callback,
    useRef<T>(value: T) {
        return (refs[refCursor++] ??= { current: value }) as { current: T }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => client,
    useQuery: () => ({ data: progress, refetch: mocks.refetch }),
}))
vi.mock('@/lib/Backups/backupCache.ts', () => ({
    ADMIN_BACKUPS_QUERY_KEY: ['admin-backups'],
    backupCreationProgressQueryOptions: (runId: string | null) => ({
        queryKey: ['progress', runId],
    }),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { error: mocks.error } }))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    clearTransferTasks: mocks.clear,
    finishExternalTransferTask: mocks.finish,
    syncExternalTransferTask: mocks.sync,
}))
vi.mock('@/lib/Backups/backupTransfer.ts', () => ({
    triggerBackupDownload: mocks.download,
}))
vi.mock(
    '@/features/Admin/Backups/Hooks/usePendingManualBackupIntent.ts',
    () => ({
        default: () => ({ state: { pendingManualBackupId: pendingId } }),
        clearPendingManualBackupIntent: mocks.clearPending,
    }),
)
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: (callback: typeof realtime) => {
        realtime = callback
        return mocks.unsubscribe
    },
}))
const { default: useProgress } =
    await import('@/features/Admin/Backups/Hooks/useBackupCreationProgressBridgeLogic.ts')
function renderProgress() {
    refCursor = 0
    renderHook(() => useProgress('user-1'))
    return runEffects()
}
function running(
    values: Partial<BackupRunCreationProgress> = {},
): BackupRunCreationProgress {
    return {
        runId: 'run-1',
        trigger: 'manual',
        status: 'running',
        phase: 'archiving',
        processedBytes: 20,
        totalBytes: 100,
        fileName: null,
        errorMessage: null,
        ...values,
    }
}
beforeEach(() => {
    resetHooks()
    refs.length = 0
    refCursor = 0
    vi.clearAllMocks()
    vi.useFakeTimers()
    progress = null
    pendingId = null
    realtime = undefined
    browserWindow = Object.assign(new EventTarget(), {
        setTimeout,
        clearTimeout,
    })
    browserDocument = Object.assign(new EventTarget(), {
        visibilityState: 'visible',
    })
    stubTestGlobal('window', browserWindow)
    stubTestGlobal('document', browserDocument)
})
afterEach(() => {
    vi.useRealTimers()
    client.clear()
    restoreTestGlobals()
})

it('shows queued pending work, clamps byte counts and calculates archiving throughput', () => {
    pendingId = 'run-1'
    let cleanup = renderProgress()
    expect(mocks.sync).toHaveBeenLastCalledWith(
        expect.objectContaining({
            indeterminate: true,
            transferredBytes: 0,
            message: 'admin.backups.progress.phaseQueued',
        }),
    )
    cleanup()
    const time = vi.spyOn(performance, 'now')
    time.mockReturnValue(1000)
    progress = running()
    cleanup = renderProgress()
    expect(mocks.sync).toHaveBeenLastCalledWith(
        expect.objectContaining({
            transferredBytes: 20,
            totalBytes: 100,
            speedBytesPerSecond: 0,
        }),
    )
    cleanup()
    time.mockReturnValue(2000)
    progress = running({ processedBytes: 120 })
    cleanup = renderProgress()
    expect(mocks.sync).toHaveBeenLastCalledWith(
        expect.objectContaining({
            transferredBytes: 100,
            speedBytesPerSecond: 100,
        }),
    )
    cleanup()
    time.mockRestore()
})

it.each([true, false])(
    'finishes a manual backup and offers a download only when the file exists: %s',
    (hasFile) => {
        pendingId = 'run-1'
        progress = running({
            status: 'completed',
            processedBytes: 100,
            fileName: hasFile ? 'synthetic.backup' : null,
        })
        const cleanup = renderProgress()
        expect(mocks.finish).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'success',
                transferredBytes: 100,
            }),
        )
        expect(mocks.clearPending).toHaveBeenCalledWith('run-1', 'user-1')
        expect(mocks.download).toHaveBeenCalledTimes(hasFile ? 1 : 0)
        if (hasFile)
            expect(mocks.download).toHaveBeenCalledWith(
                '/api/admin/backups/run-1',
                'synthetic.backup',
            )
        else
            expect(mocks.error).toHaveBeenCalledWith(
                'admin.backups.progress.downloadUnavailable',
                expect.any(Object),
            )
        cleanup()
        renderProgress()()
        expect(mocks.finish).toHaveBeenCalledTimes(1)
    },
)

it('tracks scheduled runs and clears terminal tracking without downloading them', () => {
    progress = running({
        trigger: 'scheduled',
        totalBytes: -1,
        processedBytes: -5,
    })
    let cleanup = renderProgress()
    expect(mocks.sync).toHaveBeenLastCalledWith(
        expect.objectContaining({
            totalBytes: 0,
            transferredBytes: 0,
            indeterminate: true,
        }),
    )
    vi.advanceTimersByTime(0)
    cleanup()
    progress = running({
        trigger: 'scheduled',
        status: 'completed',
        fileName: 'scheduled.backup',
    })
    cleanup = renderProgress()
    vi.advanceTimersByTime(0)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.clearPending).not.toHaveBeenCalled()
    cleanup()
})

it.each([null, 'Synthetic archiver failure'])(
    'finishes failed pending runs and clears the pending intent, message=%s',
    (errorMessage) => {
        pendingId = 'run-1'
        progress = running({ status: 'failed', errorMessage })
        renderProgress()()
        expect(mocks.finish).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'error',
                message: errorMessage ?? 'admin.backups.backupCreationFailed',
            }),
        )
        expect(mocks.clearPending).toHaveBeenCalledWith('run-1', 'user-1')
        expect(mocks.download).not.toHaveBeenCalled()
    },
)

it('refreshes on relevant realtime and browser events and removes every subscription on cleanup', () => {
    const cleanup = renderProgress()
    realtime?.({
        type: 'connection.ready',
        payload: { connectedAt: '2026-11-05T00:00:00Z' },
    })
    realtime?.({
        type: 'admin-backups.changed',
        payload: { updatedAt: '2026-11-05T00:00:00Z' },
    })
    browserWindow.dispatchEvent(new Event('focus'))
    browserWindow.dispatchEvent(new Event('pageshow'))
    browserDocument.visibilityState = 'hidden'
    browserDocument.dispatchEvent(new Event('visibilitychange'))
    expect(mocks.refetch).toHaveBeenCalledTimes(4)
    browserDocument.visibilityState = 'visible'
    browserDocument.dispatchEvent(new Event('visibilitychange'))
    expect(mocks.refetch).toHaveBeenCalledTimes(5)
    cleanup()
    browserWindow.dispatchEvent(new Event('focus'))
    expect(mocks.refetch).toHaveBeenCalledTimes(5)
    expect(mocks.clear).toHaveBeenCalledWith('backup')
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
})
