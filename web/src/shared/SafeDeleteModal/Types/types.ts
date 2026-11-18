import type { LucideIcon } from 'lucide-react'
import type { RefObject, SyntheticEvent } from 'react'

export type SafeDeleteModalProps = {
    isOpen: boolean
    question: string
    title?: string
    description?: string
    confirmLabel?: string
    confirmIcon?: LucideIcon
    confirmingLabel?: string
    cancelLabel?: string
    isConfirming?: boolean
    onClose: () => void
    onConfirm: () => void
}

export type UseSafeDeleteModalLogicProps = {
    isOpen: boolean
    isConfirming: boolean
    onClose: () => void
}

export type SafeDeleteModalLogicReturn = {
    state: { shouldRender: boolean }
    handler: {
        handleCancel: (event: SyntheticEvent<HTMLDialogElement>) => void
    }
    refs: {
        dialogRef: RefObject<HTMLDialogElement | null>
        cancelButtonRef: RefObject<HTMLButtonElement | null>
    }
}
