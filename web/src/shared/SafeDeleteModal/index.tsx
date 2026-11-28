import { createPortal } from 'react-dom'
import { useId } from 'react'
import { ToastFocusScopeBranch } from '@rentnerkev/toasts'
import { AlertTriangle, Trash2, X } from 'lucide-react'

import useTranslationStore from '@/language/useTranslationStore.ts'
import useModalDialogLogic from '@/shared/Hooks/useModalDialogLogic.ts'
import type { SafeDeleteModalProps } from '@/shared/SafeDeleteModal/Types/types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function SafeDeleteModal({
    isOpen,
    question,
    title,
    description,
    confirmLabel,
    confirmIcon: ConfirmIcon = Trash2,
    confirmingLabel,
    cancelLabel,
    isConfirming = false,
    onClose,
    onConfirm,
}: SafeDeleteModalProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { dialogRef, closeButtonRef: cancelButtonRef },
    } = useModalDialogLogic({
        isOpen,
        closeDisabled: isConfirming,
        onClose,
    })
    const titleId = useId()
    const questionId = useId()

    const resolvedTitle = title ?? t('safeDelete.title')
    const resolvedDescription = description ?? t('safeDelete.description')
    const resolvedConfirmLabel = confirmLabel ?? t('common.delete')
    const resolvedCancelLabel = cancelLabel ?? t('common.cancel')

    if (!state.shouldRender) {
        return null
    }

    return createPortal(
        <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={questionId}
            onCancel={handler.handleCancel}
            className="marketplace-signed-in marketplace-dialog-panel fixed inset-0 m-auto h-fit max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden comic-panel bg-surface-dark text-foreground open:flex backdrop:bg-marketplace-void/70 backdrop:backdrop-blur-[2px] sm:max-h-[min(44rem,calc(100dvh-3rem))] sm:w-[calc(100%-3rem)]"
        >
            <header className="marketplace-dialog-header flex shrink-0 items-center justify-between gap-5 border-b border-border-dark px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                    <HeadingIcon icon={AlertTriangle} tone="danger" size="sm" />

                    <div className="min-w-0">
                        <h2
                            id={titleId}
                            className="comic-title wrap-anywhere text-3xl text-foreground"
                        >
                            {resolvedTitle}
                        </h2>

                        <p className="mt-1.5 max-w-prose wrap-anywhere text-sm leading-relaxed text-secondary-text">
                            {resolvedDescription}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    disabled={isConfirming}
                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-secondary-text transition-colors enabled:hover:border-border-dark enabled:hover:bg-input-dark enabled:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                    aria-label={t('safeDelete.close')}
                >
                    <X
                        aria-hidden="true"
                        className="size-5"
                        strokeWidth={1.8}
                    />
                </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                <p
                    id={questionId}
                    className="text-sm leading-6 text-foreground"
                >
                    {question}
                </p>
            </div>

            <footer className="marketplace-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-dark px-5 py-4 sm:px-6 [&_button]:max-sm:flex-1">
                <button
                    ref={cancelButtonRef}
                    type="button"
                    onClick={onClose}
                    disabled={isConfirming}
                    className="flex h-11 cursor-pointer items-center justify-center rounded-md border-2 border-border-dark bg-input-dark px-4 font-comic text-sm font-bold text-secondary-text transition-colors hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {resolvedCancelLabel}
                </button>

                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isConfirming}
                    className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-ink bg-red-600 px-4 font-comic text-sm font-bold text-white shadow-[3px_3px_0_0_var(--app-comic-pop,var(--color-ink))] transition-[background-color,transform] hover:-translate-x-px hover:-translate-y-px hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <ConfirmIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                    />

                    {isConfirming
                        ? (confirmingLabel ?? t('safeDelete.confirming'))
                        : resolvedConfirmLabel}
                </button>
            </footer>
            <ToastFocusScopeBranch />
        </dialog>,
        document.body,
    )
}
