import { createPortal } from 'react-dom'
import { useId } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

import useTranslationStore from '@/language/useTranslationStore.ts'
import useSafeDeleteModalLogic from '@/shared/SafeDeleteModal/Hooks/useSafeDeleteModalLogic.ts'
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
    const { state } = useSafeDeleteModalLogic({ isOpen })
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
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-background-dark/80 p-4 backdrop-blur-sm sm:p-6">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={questionId}
                className="w-full max-w-md overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl shadow-black/30"
            >
                <div className="flex items-start justify-between gap-4 border-b border-border-dark px-6 py-4">
                    <div className="flex items-start gap-3">
                        <HeadingIcon
                            icon={AlertTriangle}
                            tone="danger"
                            size="sm"
                        />

                        <div>
                            <h2
                                id={titleId}
                                className="text-lg font-bold text-white"
                            >
                                {resolvedTitle}
                            </h2>

                            <p className="mt-1 text-sm text-secondary-text">
                                {resolvedDescription}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isConfirming}
                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={t('safeDelete.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-5 p-6">
                    <p id={questionId} className="text-sm leading-6 text-white">
                        {question}
                    </p>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isConfirming}
                            className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {resolvedCancelLabel}
                        </button>

                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={isConfirming}
                            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <ConfirmIcon className="h-4 w-4" />

                            {isConfirming
                                ? (confirmingLabel ??
                                  t('safeDelete.confirming'))
                                : resolvedConfirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    )
}
