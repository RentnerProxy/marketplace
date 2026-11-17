import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
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

let tick: (() => void) | undefined
const clearInterval = mock()
const setInterval = mock((callback: () => void, milliseconds: number) => {
    tick = callback
    expect(milliseconds).toBe(1000)
    return 123
})
mock.module('react', () => hookReact)
const { default: useBackupCountdown } =
    await import('@/features/Admin/Backups/Components/BackupRunsCard/Hooks/useBackupCountdown.ts')

beforeEach(() => {
    resetHooks()
    tick = undefined
    setInterval.mockClear()
    clearInterval.mockClear()
    stubTestGlobal('window', { setInterval, clearInterval })
})
afterEach(restoreTestGlobals)

describe('Backup runs countdown', () => {
    it('does not start a timer without a scheduled backup', () => {
        expect(renderHook(() => useBackupCountdown(null))).toBeNull()
        const cleanup = runEffects()
        cleanup()
        expect(setInterval).not.toHaveBeenCalled()
    })

    it('ticks a scheduled countdown and cleans up its timer on unmount', () => {
        const nextBackupAt = new Date(Date.now() + 120000).toISOString()
        expect(
            renderHook(() => useBackupCountdown(nextBackupAt)),
        ).not.toBeNull()
        const cleanup = runEffects()
        expect(setInterval).toHaveBeenCalledTimes(1)
        expect(tick).toBeDefined()
        tick?.()
        expect(
            renderHook(() => useBackupCountdown(nextBackupAt)),
        ).not.toBeNull()
        cleanup()
        expect(clearInterval).toHaveBeenCalledWith(123)
    })
})
