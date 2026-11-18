import { beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import type { ActionMenuItem } from '@/shared/ActionMenu/Types/action-menu.types.ts'

vi.mock('react', () => ({
    ...hookReact,
    useRef: (current: unknown) => ({ current }),
}))
vi.mock('react-dom', () => ({
    flushSync: (callback: () => void) => callback(),
}))

const { default: useActionMenuLogic } =
    await import('@/shared/ActionMenu/Hooks/useActionMenuLogic.ts')

beforeEach(resetHooks)

it('preserves an enabled download link and removes href from blocked actions', () => {
    const entries: ActionMenuItem[] = [
        { id: 'open', label: 'Open', onSelect: vi.fn() },
        {
            id: 'download',
            label: 'Download',
            href: '/api/example',
            download: true,
        },
        {
            id: 'blocked',
            label: 'Blocked',
            href: '/api/blocked',
            disabled: true,
            description: 'Unavailable',
        },
    ]
    const { state } = renderHook(() => useActionMenuLogic(entries))
    expect(state.items[1]).toMatchObject({
        type: 'link',
        href: '/api/example',
        download: true,
    })
    expect(state.items[2]).toMatchObject({
        disabled: true,
        description: 'Unavailable',
    })
    expect(state.items[2]).not.toHaveProperty('href')
})

it('closes the menu and restores trigger focus before running a row action', () => {
    const focus = vi.fn()
    const open = vi.fn(() => expect(focus).toHaveBeenCalledTimes(1))
    const blocked = vi.fn()
    const actions: ActionMenuItem[] = [
        { id: 'details', label: 'Details', onSelect: open },
        {
            id: 'delete',
            label: 'Delete',
            destructive: true,
            disabled: true,
            onSelect: blocked,
        },
    ]
    const render = () => renderHook(() => useActionMenuLogic(actions))
    render().handler.handleOpenChange(true)
    const { state, handler, refs } = render()
    refs.triggerRef.current = { focus } as unknown as HTMLButtonElement

    expect(state.open).toBe(true)
    expect(state.items[1]).toMatchObject({ danger: true, disabled: true })
    handler.handleAction('delete')
    handler.handleAction('missing')
    expect(blocked).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    handler.handleAction('details')
    expect(open).toHaveBeenCalledTimes(1)
    expect(render().state.open).toBe(false)
})
