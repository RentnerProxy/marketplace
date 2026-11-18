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
vi.mock('react', () => hookReact)
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
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { body: { style: { overflow: 'auto' } } },
    })
})
afterEach(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
})

it('locks page scrolling only while open and restores the exact previous style', () => {
    expect(
        renderHook(() => useModal({ isOpen: false })).state.shouldRender,
    ).toBe(false)
    runEffects()()
    expect(document.body.style.overflow).toBe('auto')
    expect(
        renderHook(() => useModal({ isOpen: true })).state.shouldRender,
    ).toBe(true)
    const cleanup = runEffects()
    expect(document.body.style.overflow).toBe('hidden')
    cleanup()
    expect(document.body.style.overflow).toBe('auto')
    mounted = false
    expect(
        renderHook(() => useModal({ isOpen: true })).state.shouldRender,
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
        expect(html).toContain('role="dialog"')
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
