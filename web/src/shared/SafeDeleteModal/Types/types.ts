import type { LucideIcon } from 'lucide-react'

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
