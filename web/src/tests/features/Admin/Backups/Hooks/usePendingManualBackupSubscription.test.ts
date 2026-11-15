import { afterEach, beforeEach, expect, it, setSystemTime, vi } from 'bun:test'
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

const userId = '019f5b07-80e2-7000-8000-000000000002'
const runId = '019f5b07-80e2-7000-8000-000000000001'
const otherUser = '019f5b07-80e2-7000-8000-000000000003'
const storage = new Map<string, string>()
const cleanups: Array<() => void> = []
const notify = vi.fn()
const scheduled: Array<() => void> = []
vi.mock('react', () => ({
    ...hookReact,
    useSyncExternalStore<T>(
        subscribe: (listener: () => void) => () => void,
        snapshot: () => T,
        serverSnapshot: () => T,
    ) {
        cleanups.push(subscribe(notify))
        expect(serverSnapshot()).toBeNull()
        return snapshot()
    },
}))
const {
    default: useIntent,
    clearPendingManualBackupIntent,
    getPendingManualBackupIntent,
    setPendingManualBackupIntent,
} = await import('@/features/Admin/Backups/Hooks/usePendingManualBackupIntent.ts')
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    storage.clear()
    scheduled.length = 0
    stubTestGlobal('window', {
        setTimeout(callback: () => void, delay: number) {
            scheduled.push(callback)
            return setTimeout(callback, delay)
        },
        clearTimeout,
        sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        },
    })
})
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    clearPendingManualBackupIntent()
    vi.useRealTimers()
    restoreTestGlobals()
})

it('loads a persisted user-bound intent, notifies subscribers and stops notifying after unsubscribe', () => {
    storage.set(
        'rentnerproxy-marketplace:pending-manual-backup:v1',
        JSON.stringify({ userId, runId, queuedAt: Date.now() }),
    )
    expect(
        renderHook(() => useIntent(userId)).state.pendingManualBackupId,
    ).toBe(runId)
    expect(
        renderHook(() =>
            useIntent(userId),
        ).handler.handleSetPendingManualBackup(runId),
    ).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    cleanups.splice(0).forEach((cleanup) => cleanup())
    notify.mockClear()
    clearPendingManualBackupIntent(runId, userId)
    expect(notify).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
})

it('rejects anonymous writes and removes a previous user’s intent after identity changes', () => {
    expect(
        renderHook(() => useIntent(null)).handler.handleSetPendingManualBackup(
            runId,
        ),
    ).toBe(false)
    setPendingManualBackupIntent({ runId, userId })
    expect(
        renderHook(() => useIntent(otherUser)).state.pendingManualBackupId,
    ).toBeNull()
    runEffects()()
    expect(getPendingManualBackupIntent()).toBeNull()
})

it('expires a pending run through its subscribed timer and cancels the expiration on unmount', () => {
    setPendingManualBackupIntent({ runId, userId })
    renderHook(() => useIntent(userId))
    let cleanup = runEffects()
    expect(vi.getTimerCount()).toBe(1)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
    renderHook(() => useIntent(userId))
    cleanup = runEffects()
    vi.advanceTimersByTime(24 * 60 * 60_000 + 1)
    expect(getPendingManualBackupIntent()).toBeNull()
    expect(storage.size).toBe(0)
    expect(notify).toHaveBeenCalled()
    cleanup()
})

it.each([false, true])(
    'preserves a replacement intent against an old timer and notifies its own expiry, alreadyExpired=%s',
    (alreadyExpired) => {
        const nextRunId = '019f5b07-80e2-7000-8000-000000000004'
        setPendingManualBackupIntent({ runId, userId })
        renderHook(() => useIntent(userId))
        const oldCleanup = runEffects()
        const startedAt = Date.now()
        setSystemTime(new Date(startedAt + 60_000))
        setPendingManualBackupIntent({ runId: nextRunId, userId })
        renderHook(() => useIntent(userId))
        const nextCleanup = runEffects()
        notify.mockClear()
        if (alreadyExpired)
            setSystemTime(new Date(startedAt + 24 * 60 * 60_000 + 120_000))
        scheduled[0]?.()
        expect(notify).not.toHaveBeenCalled()
        expect([...storage.values()][0]).toContain(nextRunId)
        if (!alreadyExpired)
            expect(getPendingManualBackupIntent()?.runId).toBe(nextRunId)
        setSystemTime(new Date(startedAt + 24 * 60 * 60_000 + 120_000))
        scheduled[1]?.()
        expect(notify).toHaveBeenCalledTimes(1)
        expect(getPendingManualBackupIntent()).toBeNull()
        expect(storage.size).toBe(0)
        oldCleanup()
        nextCleanup()
    },
)
