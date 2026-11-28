import { useId } from 'react'
import { createPortal } from 'react-dom'
import { ToastFocusScopeBranch } from '@rentnerkev/toasts'
import { X } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useModalDialogLogic from '@/shared/Hooks/useModalDialogLogic.ts'
import type { RowDetailsDialogProps } from './Types/row-details-dialog.types.ts'

export default function RowDetailsDialog({
    title,
    onClose,
    closeDisabled = false,
    children,
    footer,
}: RowDetailsDialogProps) {
    const { t } = useTranslationStore()
    const titleId = useId()
    const {
        state,
        handler,
        refs: { dialogRef, closeButtonRef },
    } = useModalDialogLogic({
        isOpen: true,
        closeDisabled,
        onClose,
    })

    if (!state.shouldRender) return null

    return createPortal(
        <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={titleId}
            onCancel={handler.handleCancel}
            className="marketplace-signed-in marketplace-dialog-panel fixed inset-0 m-auto h-fit max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark text-foreground open:flex backdrop:bg-marketplace-void/70 backdrop:backdrop-blur-[2px] sm:max-h-[min(44rem,calc(100dvh-3rem))] sm:w-[calc(100%-3rem)]"
        >
            <header className="marketplace-dialog-header flex shrink-0 items-center justify-between gap-5 border-b border-border-dark px-5 py-4 sm:px-6">
                <h2
                    id={titleId}
                    className="min-w-0 wrap-anywhere text-lg leading-tight font-extrabold text-(color:--marketplace-ink-soft) sm:text-xl"
                >
                    {title}
                </h2>
                <button
                    ref={closeButtonRef}
                    type="button"
                    aria-label={t('common.close')}
                    disabled={closeDisabled}
                    onClick={onClose}
                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-secondary-text transition-colors enabled:hover:border-border-dark enabled:hover:bg-input-dark enabled:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                >
                    <X
                        aria-hidden="true"
                        className="size-5"
                        strokeWidth={1.8}
                    />
                </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                {children}
            </div>
            {footer && (
                <footer className="marketplace-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-dark px-5 py-4 sm:px-6 [&_button]:max-sm:flex-1">
                    {footer}
                </footer>
            )}
            <ToastFocusScopeBranch />
        </dialog>,
        document.body,
    )
}
