import { useEffect, useRef } from 'react'
import type {
    ModalDialogLogicReturn,
    UseModalDialogLogicProps,
} from '@/shared/Types/modal-dialog.types.ts'
import useHasMounted from '@/shared/Hooks/useHasMounted.ts'

export default function useModalDialogLogic({
    isOpen,
    closeDisabled,
    onClose,
}: UseModalDialogLogicProps): ModalDialogLogicReturn {
    const mounted = useHasMounted()
    const shouldRender = isOpen && mounted
    const dialogRef = useRef<HTMLDialogElement>(null)
    const closeButtonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const dialog = dialogRef.current
        if (!shouldRender || !dialog) return undefined

        const { ownerDocument } = dialog
        const trigger = ownerDocument.activeElement
        const style = ownerDocument.body.style
        const previousOverflow = style.overflow
        dialog.showModal()
        style.overflow = 'hidden'
        closeButtonRef.current?.focus()

        return () => {
            dialog.close()
            style.overflow = previousOverflow
            if (trigger instanceof HTMLElement && trigger.isConnected) {
                trigger.focus()
            }
        }
    }, [shouldRender])

    return {
        state: { shouldRender },
        handler: {
            handleCancel: (event) => {
                event.preventDefault()
                if (!closeDisabled) onClose()
            },
        },
        refs: { dialogRef, closeButtonRef },
    }
}
