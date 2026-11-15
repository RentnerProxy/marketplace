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

const toast = mock()
const reload = mock()
const writeText = mock(async (_value: string) => {})
let resetCopied: (() => void) | undefined
const timeout = mock((callback: () => void, milliseconds: number) => {
    resetCopied = callback
    expect(milliseconds).toBe(2000)
})
const originalDev = process.env.DEV
const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
)
mock.module('react', () => hookReact)
mock.module('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: toast,
}))
const { default: useRouteErrorLogic } =
    await import('@/shared/RouteErrorComponent/Hooks/useRouteErrorLogic.ts')
const props = {
    error: new Error('Synthetic private detail'),
    reset: mock(),
    info: { componentStack: 'ComponentStack' },
}

beforeEach(() => {
    resetHooks()
    toast.mockClear()
    reload.mockClear()
    writeText.mockReset().mockResolvedValue(undefined)
    resetCopied = undefined
    stubTestGlobal('window', { location: { reload }, setTimeout: timeout })
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText } },
    })
    delete process.env.DEV
})
afterEach(() => {
    restoreTestGlobals()
    if (originalNavigator)
        Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
    if (originalDev === undefined) delete process.env.DEV
    else process.env.DEV = originalDev
})

describe('Route error recovery logic', () => {
    it('uses a safe production toast, toggles diagnostics and reloads through its explicit action', () => {
        const logic = renderHook(() => useRouteErrorLogic(props))
        runEffects()()
        expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Die Anfrage konnte nicht verarbeitet werden.',
            }),
        )
        logic.setter.setIsTechnicalDetailsOpen(true)
        expect(
            renderHook(() => useRouteErrorLogic(props)).state
                .isTechnicalDetailsOpen,
        ).toBe(true)
        logic.handler.handleReload()
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('copies development diagnostics, resets feedback after the timeout and handles denied clipboard access', async () => {
        process.env.DEV = 'true'
        const logic = renderHook(() => useRouteErrorLogic(props))
        runEffects()()
        expect(toast).toHaveBeenCalledWith(props.error)
        await logic.handler.handleCopyTechnicalDetails()
        expect(writeText).toHaveBeenCalledWith(
            logic.state.details.technicalDetails,
        )
        expect(renderHook(() => useRouteErrorLogic(props)).state.copied).toBe(
            true,
        )
        expect(resetCopied).toBeDefined()
        resetCopied?.()
        expect(renderHook(() => useRouteErrorLogic(props)).state.copied).toBe(
            false,
        )
        writeText.mockRejectedValue(new Error('Clipboard denied'))
        await logic.handler.handleCopyTechnicalDetails()
        expect(renderHook(() => useRouteErrorLogic(props)).state.copied).toBe(
            false,
        )
    })
})
