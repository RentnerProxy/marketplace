import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import * as React from 'react'
import type { CustomBackgroundPreviewViewport } from '@/features/UserSettings/Components/AppearanceSection/Types/custom-background-logic.types.ts'

const actualReact = { ...React }
let viewport: CustomBackgroundPreviewViewport | undefined
let effect: React.EffectCallback | undefined
let cleanup: (() => void) | undefined
const addEventListener = vi.fn()
const removeEventListener = vi.fn()
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
)
const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'ResizeObserver',
)

vi.mock('react', () => ({
    ...actualReact,
    useState(initial: CustomBackgroundPreviewViewport) {
        viewport ??= initial
        return [
            viewport,
            (
                updater: (
                    previous: CustomBackgroundPreviewViewport,
                ) => CustomBackgroundPreviewViewport,
            ) => {
                viewport = updater(viewport ?? initial)
            },
        ]
    },
    useEffect(callback: React.EffectCallback) {
        effect = callback
    },
}))
const { default: useCustomBackgroundPreviewLayout } =
    await import('@/features/UserSettings/Components/AppearanceSection/Hooks/useCustomBackgroundPreviewLayout.ts')

describe('Hintergrund-Vorschau im aktuellen Fensterformat', function () {
    beforeEach(function () {
        viewport = undefined
        effect = undefined
        cleanup = undefined
        addEventListener.mockClear()
        removeEventListener.mockClear()
    })

    afterEach(function () {
        cleanup?.()
        if (windowDescriptor) {
            Object.defineProperty(globalThis, 'window', windowDescriptor)
        } else {
            Reflect.deleteProperty(globalThis, 'window')
        }
        if (documentDescriptor) {
            Object.defineProperty(globalThis, 'document', documentDescriptor)
        } else {
            Reflect.deleteProperty(globalThis, 'document')
        }
        if (resizeObserverDescriptor) {
            Object.defineProperty(
                globalThis,
                'ResizeObserver',
                resizeObserverDescriptor,
            )
        } else {
            Reflect.deleteProperty(globalThis, 'ResizeObserver')
        }
    })

    it.each([false, true])(
        'erhält das Format des echten Bildbereichs bei isCollapsed=%s',
        function (isCollapsed) {
            const { state } = useCustomBackgroundPreviewLayout(isCollapsed)

            const sidebarRatio = Number.parseFloat(state.sidebarWidth) / 100
            expect(state.aspectRatio * (1 - sidebarRatio)).toBeCloseTo(
                (1920 - (isCollapsed ? 80 : 288)) / 1080,
            )
            expect(sidebarRatio).toBeCloseTo(isCollapsed ? 80 / 1920 : 0.18)
            expect(Number.parseFloat(state.topbarHeight)).toBeCloseTo(
                (72 / 1080) * 100,
            )
        },
    )

    it('folgt der Fenstergröße und entfernt den Resize-Listener beim Schließen', function () {
        const root = { clientWidth: 1260 }
        const observe = vi.fn()
        const disconnect = vi.fn()
        let resizeRoot: (() => void) | undefined
        const browserWindow = {
            innerWidth: 1280,
            innerHeight: 800,
            getComputedStyle: () => ({ fontSize: '18px' }),
            addEventListener,
            removeEventListener,
        }
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { documentElement: root },
        })
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: browserWindow,
        })
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class {
                observe = observe
                disconnect = disconnect
                constructor(callback: () => void) {
                    resizeRoot = callback
                }
            },
        })

        useCustomBackgroundPreviewLayout(false)
        const effectCleanup = effect?.()
        cleanup =
            typeof effectCleanup === 'function' ? effectCleanup : undefined
        const { state } = useCustomBackgroundPreviewLayout(false)

        expect(state.aspectRatio).toBe(1260 / 800)
        expect(Number.parseFloat(state.sidebarWidth)).toBeCloseTo(
            (324 / 1260) * 100,
        )
        expect(Number.parseFloat(state.topbarHeight)).toBeCloseTo(
            (81 / 800) * 100,
        )
        expect(addEventListener).toHaveBeenCalledTimes(1)
        expect(observe).toHaveBeenCalledWith(root)
        const resize = addEventListener.mock.calls[0][1] as () => void
        root.clientWidth = 1800
        browserWindow.innerHeight = 1000
        resize()
        const resizedState = useCustomBackgroundPreviewLayout(true).state

        expect(resizedState.aspectRatio).toBe(1.8)
        expect(Number.parseFloat(resizedState.sidebarWidth)).toBe(5)
        expect(Number.parseFloat(resizedState.topbarHeight)).toBe(8.1)
        root.clientWidth = 1784
        resizeRoot?.()
        expect(useCustomBackgroundPreviewLayout(true).state.aspectRatio).toBe(
            1.784,
        )
        cleanup?.()
        cleanup = undefined
        expect(removeEventListener).toHaveBeenCalledWith('resize', resize)
        expect(disconnect).toHaveBeenCalledTimes(1)
    })
})
