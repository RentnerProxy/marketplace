import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '../hook-harness.ts'

vi.mock('react', () => hookReact)
let publicRegistrationEnabled: boolean | undefined
vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: { isPublicRegistrationEnabled: publicRegistrationEnabled },
    }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => ({}),
}))
const { default: usePublicHeaderLogic } =
    await import('@/layouts/PublicLayout/Hooks/usePublicHeaderLogic.ts')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const listeners = new Map<string, EventListener>()
const windowMock = {
    scrollY: 0,
    addEventListener: vi.fn((name: string, listener: EventListener) =>
        listeners.set(name, listener),
    ),
    removeEventListener: vi.fn((name: string, _listener: EventListener) =>
        listeners.delete(name),
    ),
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    listeners.clear()
    publicRegistrationEnabled = undefined
    windowMock.scrollY = 0
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: windowMock,
    })
})
afterEach(() => {
    if (originalWindow)
        Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
})

it('shows the registration entry only when the server setting enables it', () => {
    expect(
        renderHook(usePublicHeaderLogic).state.isPublicRegistrationEnabled,
    ).toBe(false)
    publicRegistrationEnabled = true
    expect(
        renderHook(usePublicHeaderLogic).state.isPublicRegistrationEnabled,
    ).toBe(true)
    publicRegistrationEnabled = false
    expect(
        renderHook(usePublicHeaderLogic).state.isPublicRegistrationEnabled,
    ).toBe(false)
})

it('updates the attached header appearance while scrolling and removes its listener', () => {
    expect(renderHook(usePublicHeaderLogic).state.isScrolled).toBe(false)
    const cleanup = runEffects()
    expect(windowMock.addEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function),
        { passive: true },
    )
    windowMock.scrollY = 100
    listeners.get('scroll')?.(new Event('scroll'))
    expect(renderHook(usePublicHeaderLogic).state.isScrolled).toBe(true)
    windowMock.scrollY = 0
    listeners.get('scroll')?.(new Event('scroll'))
    expect(renderHook(usePublicHeaderLogic).state.isScrolled).toBe(false)
    cleanup()
    expect(windowMock.removeEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function),
    )
    expect(listeners.size).toBe(0)
})
