import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '../../layouts/hook-harness.ts'

let mounted = true
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const oldHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    'HTMLElement',
)
class FocusableElement {
    isConnected = true
    focus = vi.fn()
}
let opener: FocusableElement
vi.mock('react', () => ({
    ...hookReact,
    useRef: (initial: unknown) => ({ current: initial }),
}))
vi.mock('react-dom', () => ({
    createPortal: (children: ReactNode) => children,
}))
vi.mock('@/shared/Hooks/useHasMounted.ts', () => ({ default: () => mounted }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const { default: Modal } = await import('@/shared/SafeDeleteModal/index.tsx')
const { default: useModal } =
    await import('@/shared/SafeDeleteModal/Hooks/useSafeDeleteModalLogic.ts')
beforeEach(() => {
    resetHooks()
    mounted = true
    opener = new FocusableElement()
    Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: FocusableElement,
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { body: { style: { overflow: 'auto' } }, activeElement: opener },
    })
})
afterEach(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (oldHTMLElement)
        Object.defineProperty(globalThis, 'HTMLElement', oldHTMLElement)
    else Reflect.deleteProperty(globalThis, 'HTMLElement')
})

it('opens a native modal, moves focus to Cancel, and restores focus and scroll on close', () => {
    const props = { isOpen: false, isConfirming: false, onClose: vi.fn() }
    expect(renderHook(() => useModal(props)).state.shouldRender).toBe(false)
    runEffects()()
    expect(document.body.style.overflow).toBe('auto')
    const { state, refs } = renderHook(() =>
        useModal({ ...props, isOpen: true }),
    )
    const dialog = {
        ownerDocument: document,
        showModal: vi.fn(),
        close: vi.fn(),
    }
    const cancel = new FocusableElement()
    refs.dialogRef.current = dialog as unknown as HTMLDialogElement
    refs.cancelButtonRef.current = cancel as unknown as HTMLButtonElement
    expect(state.shouldRender).toBe(true)
    const cleanup = runEffects()
    expect(document.body.style.overflow).toBe('hidden')
    expect(dialog.showModal).toHaveBeenCalledTimes(1)
    expect(cancel.focus).toHaveBeenCalledTimes(1)
    cleanup()
    expect(dialog.close).toHaveBeenCalledTimes(1)
    expect(opener.focus).toHaveBeenCalledTimes(1)
    expect(document.body.style.overflow).toBe('auto')
    mounted = false
    expect(
        renderHook(() => useModal({ ...props, isOpen: true })).state
            .shouldRender,
    ).toBe(false)
})

it.each([false, true])(
    'renders an accessible confirmation dialog with pending=%s',
    (isConfirming) => {
        const html = renderHook(() =>
            renderToStaticMarkup(
                createElement(Modal, {
                    isOpen: true,
                    isConfirming,
                    question: 'Delete synthetic record?',
                    onClose: vi.fn(),
                    onConfirm: vi.fn(),
                }),
            ),
        )
        expect(html).toContain('<dialog')
        expect(html).toContain('aria-modal="true"')
        const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1]
        expect(describedBy).toBeDefined()
        expect(html).toContain(`id="${describedBy}"`)
        expect(html).toContain('Delete synthetic record?')
        expect(html).toContain(
            isConfirming ? 'safeDelete.confirming' : 'common.delete',
        )
        expect((html.match(/disabled=""/gu) ?? []).length).toBe(
            isConfirming ? 3 : 0,
        )
    },
)

it.each([false, true])(
    'handles Escape without interrupting a pending action=%s',
    (isConfirming) => {
        const onClose = vi.fn()
        const event = { preventDefault: vi.fn() }
        const { handler } = renderHook(() =>
            useModal({ isOpen: true, isConfirming, onClose }),
        )
        handler.handleCancel(
            event as unknown as Parameters<typeof handler.handleCancel>[0],
        )
        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(isConfirming ? 0 : 1)
    },
)

it('omits a closed dialog and accepts explicit action copy', () => {
    const props = {
        isOpen: false,
        question: 'Question',
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        title: 'Remove account',
        description: 'Cannot undo',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
    }
    expect(
        renderHook(() => renderToStaticMarkup(createElement(Modal, props))),
    ).toBe('')
    const html = renderHook(() =>
        renderToStaticMarkup(createElement(Modal, { ...props, isOpen: true })),
    )
    for (const text of ['Remove account', 'Cannot undo', 'Remove', 'Keep'])
        expect(html).toContain(text)
})
