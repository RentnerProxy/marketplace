import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { KeyboardEvent, PointerEvent } from 'react'
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

vi.mock('react', () => ({
    ...hookReact,
    useRef: (initial: unknown) =>
        hookReact.useState(() => ({ current: initial }))[0],
}))

const { default: useSidebarScrollGrip } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useSidebarScrollGrip.ts')

type FakeNavigation = {
    clientHeight: number
    scrollHeight: number
    scrollTop: number
    offsetTop: number
    parentElement: { clientHeight: number } | null
    firstElementChild: object | null
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
}

const observers: Array<{
    callback: () => void
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
}> = []

class FakeResizeObserver {
    observe = vi.fn()
    disconnect = vi.fn()

    constructor(callback: () => void) {
        observers.push({
            callback,
            observe: this.observe,
            disconnect: this.disconnect,
        })
    }
}

function createNavigation(
    overrides: Partial<FakeNavigation> = {},
): FakeNavigation {
    return {
        clientHeight: 400,
        scrollHeight: 1000,
        scrollTop: 0,
        offsetTop: 20,
        parentElement: { clientHeight: 600 },
        firstElementChild: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ...overrides,
    }
}

const render = () => renderHook(useSidebarScrollGrip)

function mount(navigation: FakeNavigation) {
    render().refs.navigation.current = navigation as unknown as HTMLElement
    const cleanup = runEffects()
    return { cleanup, grip: render() }
}

function scrollListener(navigation: FakeNavigation) {
    const [event, listener, options] =
        navigation.addEventListener.mock.calls[0] ?? []
    expect(event).toBe('scroll')
    expect(options).toEqual({ passive: true })
    return listener as () => void
}

function pointer(overrides: Record<string, unknown> = {}) {
    const currentTarget = { setPointerCapture: vi.fn(), focus: vi.fn() }
    const event = {
        isPrimary: true,
        button: 0,
        pointerId: 7,
        clientY: 100,
        currentTarget,
        ...overrides,
    }
    return {
        event: event as unknown as PointerEvent<HTMLDivElement>,
        currentTarget,
    }
}

function key(name: string) {
    const preventDefault = vi.fn()
    return {
        event: {
            key: name,
            preventDefault,
        } as unknown as KeyboardEvent<HTMLDivElement>,
        preventDefault,
    }
}

beforeEach(() => {
    resetHooks()
    observers.length = 0
    stubTestGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
    restoreTestGlobals()
})

describe('sidebar scroll grip position', () => {
    it('stays hidden and inert until the navigation is mounted inside its frame', () => {
        render()
        runEffects()
        expect(observers).toHaveLength(0)
        expect(render().state.position).toBeNull()

        const navigation = createNavigation({ parentElement: null })
        const { cleanup, grip } = mount(navigation)
        expect(observers).toHaveLength(0)
        expect(grip.state.position).toBeNull()
        expect(() => cleanup()).not.toThrow()
    })

    it('sizes the grip to the visible share and follows the curved sidebar edge', () => {
        const navigation = createNavigation()
        const { grip } = mount(navigation)

        expect(observers).toHaveLength(1)
        expect(observers[0]?.observe).toHaveBeenCalledTimes(3)
        expect(grip.state.position).toMatchObject({
            scrollTop: 0,
            maxScroll: 600,
            travel: 344,
            style: { height: 56, top: 20 },
        })
        const topLeft = String(grip.state.position?.style.left)
        expect(topLeft).toMatch(
            /^calc\(100% - var\(--marketplace-sidebar-tail\) \* 0\.\d+ \+ 0\.34375rem\)$/,
        )

        navigation.scrollTop = 900
        scrollListener(navigation)()
        const bottom = render().state.position
        expect(bottom?.scrollTop).toBe(600)
        expect(bottom?.style.top).toBe(364)
        expect(String(bottom?.style.left)).not.toBe(topLeft)
    })

    it('keeps a minimum grip height for very long navigation lists', () => {
        const { grip } = mount(createNavigation({ scrollHeight: 20000 }))
        expect(grip.state.position?.style.height).toBe(32)
        expect(grip.state.position?.travel).toBe(368)
    })

    it('hides the grip once resizing leaves nothing to scroll and cleans up', () => {
        const navigation = createNavigation()
        const { cleanup } = mount(navigation)
        expect(render().state.position).not.toBeNull()

        navigation.scrollHeight = navigation.clientHeight
        observers[0]?.callback()
        expect(render().state.position).toBeNull()

        navigation.scrollHeight = 1000
        navigation.clientHeight = 30
        observers[0]?.callback()
        expect(render().state.position).toBeNull()

        const listener = scrollListener(navigation)
        cleanup()
        expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1)
        expect(navigation.removeEventListener).toHaveBeenCalledWith(
            'scroll',
            listener,
        )
    })
})

describe('sidebar scroll grip dragging', () => {
    it('ignores pointers before the grip is visible', () => {
        const { event, currentTarget } = pointer()
        render().handler.handlePointerDown(event)
        expect(currentTarget.setPointerCapture).not.toHaveBeenCalled()
    })

    it('ignores secondary buttons and non-primary pointers', () => {
        const { grip } = mount(createNavigation())
        for (const overrides of [{ button: 2 }, { isPrimary: false }]) {
            const { event, currentTarget } = pointer(overrides)
            grip.handler.handlePointerDown(event)
            expect(currentTarget.setPointerCapture).not.toHaveBeenCalled()
        }
    })

    it('scrolls proportionally while the captured pointer moves and stops on release', () => {
        const navigation = createNavigation()
        const { grip } = mount(navigation)
        const { event, currentTarget } = pointer()

        grip.handler.handlePointerDown(event)
        expect(currentTarget.setPointerCapture).toHaveBeenCalledWith(7)
        expect(currentTarget.focus).toHaveBeenCalledWith({
            preventScroll: true,
        })

        grip.handler.handlePointerMove(pointer({ clientY: 186 }).event)
        expect(navigation.scrollTop).toBeCloseTo(150)

        grip.handler.handlePointerMove(
            pointer({ pointerId: 8, clientY: 400 }).event,
        )
        expect(navigation.scrollTop).toBeCloseTo(150)

        grip.handler.handlePointerEnd(pointer({ pointerId: 8 }).event)
        grip.handler.handlePointerMove(pointer({ clientY: 100 }).event)
        expect(navigation.scrollTop).toBeCloseTo(0)

        grip.handler.handlePointerEnd(pointer().event)
        grip.handler.handlePointerMove(pointer({ clientY: 300 }).event)
        expect(navigation.scrollTop).toBeCloseTo(0)
    })

    it('drops an active drag when the navigation unmounts', () => {
        const navigation = createNavigation()
        const { cleanup, grip } = mount(navigation)
        grip.handler.handlePointerDown(pointer().event)
        cleanup()
        grip.handler.handlePointerMove(pointer({ clientY: 186 }).event)
        expect(navigation.scrollTop).toBe(0)
    })
})

describe('sidebar scroll grip keyboard', () => {
    it('does nothing without a mounted navigation', () => {
        const { event, preventDefault } = key('ArrowDown')
        render().handler.handleKeyDown(event)
        expect(preventDefault).not.toHaveBeenCalled()
    })

    it.each([
        ['ArrowDown', 240],
        ['ArrowUp', 160],
        ['PageDown', 600],
        ['PageUp', -200],
        ['Home', 0],
        ['End', 1000],
    ])('moves the navigation for %s', (name, expected) => {
        const navigation = createNavigation({ scrollTop: 200 })
        const { grip } = mount(navigation)
        const { event, preventDefault } = key(name)
        grip.handler.handleKeyDown(event)
        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(navigation.scrollTop).toBe(expected)
    })

    it('leaves other keys to the browser', () => {
        const navigation = createNavigation({ scrollTop: 200 })
        const { grip } = mount(navigation)
        const { event, preventDefault } = key('Tab')
        grip.handler.handleKeyDown(event)
        expect(preventDefault).not.toHaveBeenCalled()
        expect(navigation.scrollTop).toBe(200)
    })
})
