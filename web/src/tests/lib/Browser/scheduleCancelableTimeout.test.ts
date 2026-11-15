import { afterEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

afterEach(restoreTestGlobals)

describe('scheduleCancelableTimeout', function () {
    it('kann ohne Browser importiert werden und startet dabei keinen Timer', async function () {
        stubTestGlobal('window', undefined)

        const { scheduleCancelableTimeout } =
            await import('@/lib/Browser/scheduleCancelableTimeout.ts')

        expect(typeof scheduleCancelableTimeout).toBe('function')
        expect(typeof window).toBe('undefined')
    })

    it('übergibt Callback und Verzögerung erst beim Aufruf an den Browser', async function () {
        const setTimeout = vi.fn((_callback: () => void, _delayMs: number) => 7)
        const clearTimeout = vi.fn((_timer: number) => {})
        stubTestGlobal('window', { setTimeout, clearTimeout })
        const { scheduleCancelableTimeout } =
            await import('@/lib/Browser/scheduleCancelableTimeout.ts')
        const callback = vi.fn()

        expect(setTimeout).not.toHaveBeenCalled()
        const cancel = scheduleCancelableTimeout(callback, 1_234)

        expect(setTimeout).toHaveBeenCalledTimes(1)
        expect(setTimeout).toHaveBeenCalledWith(callback, 1_234)
        expect(callback).not.toHaveBeenCalled()
        expect(clearTimeout).not.toHaveBeenCalled()
        cancel()
        expect(clearTimeout).toHaveBeenCalledTimes(1)
        expect(clearTimeout).toHaveBeenCalledWith(7)
    })

    it('bricht nur den eigenen Timer ab und lässt andere Callbacks bestehen', async function () {
        let timerId = 0
        const scheduled = new Map<number, () => void>()
        const setTimeout = vi.fn((callback: () => void, _delayMs: number) => {
            scheduled.set(++timerId, callback)
            return timerId
        })
        const clearTimeout = vi.fn((timer: number) => {
            scheduled.delete(timer)
        })
        stubTestGlobal('window', { setTimeout, clearTimeout })
        const { scheduleCancelableTimeout } =
            await import('@/lib/Browser/scheduleCancelableTimeout.ts')
        const first = vi.fn()
        const second = vi.fn()
        const cancelFirst = scheduleCancelableTimeout(first, 0)
        const cancelSecond = scheduleCancelableTimeout(second, 60_000)

        cancelFirst()
        expect([...scheduled.keys()]).toEqual([2])
        scheduled.get(2)?.()

        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
        cancelSecond()
        expect(scheduled.size).toBe(0)
        expect(clearTimeout.mock.calls).toEqual([[1], [2]])
    })
})
