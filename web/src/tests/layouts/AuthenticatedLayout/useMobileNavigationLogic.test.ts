import { afterEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '../hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

vi.mock('react', () => hookReact)

const { default: useMobileNavigationLogic } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useMobileNavigationLogic.ts')

afterEach(() => {
    resetHooks()
    restoreTestGlobals()
})

it('closes the mobile drawer when crossing into the desktop layout and removes its listener', () => {
    const desktop = {
        matches: false,
        addEventListener: vi.fn((_event: string, _listener: () => void) => {}),
        removeEventListener: vi.fn(),
    }
    const matchMedia = vi.fn(() => desktop)
    stubTestGlobal('window', { matchMedia })

    const closed = renderHook(useMobileNavigationLogic)
    runEffects()()
    expect(matchMedia).not.toHaveBeenCalled()
    closed.handler.handleOpen()
    expect(renderHook(useMobileNavigationLogic).state.isOpen).toBe(true)
    const cleanup = runEffects()
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 64rem)')

    const listener = desktop.addEventListener.mock.calls[0]?.[1]
    if (!listener) throw new Error('Missing desktop breakpoint listener')
    listener()
    expect(renderHook(useMobileNavigationLogic).state.isOpen).toBe(true)
    desktop.matches = true
    listener()
    expect(renderHook(useMobileNavigationLogic).state.isOpen).toBe(false)
    cleanup()
    expect(desktop.removeEventListener).toHaveBeenCalledWith('change', listener)
})
