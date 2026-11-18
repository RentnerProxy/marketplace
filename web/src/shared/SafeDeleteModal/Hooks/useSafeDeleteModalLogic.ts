import type { SafeDeleteModalLogicReturn } from '../Types/types.ts'
import { useEffect, useRef } from 'react'
import type { UseSafeDeleteModalLogicProps } from '@/shared/SafeDeleteModal/Types/types.ts'
import useHasMounted from '@/shared/Hooks/useHasMounted.ts'

export default function useSafeDeleteModalLogic({
    isOpen,
    isConfirming,
    onClose,
}: UseSafeDeleteModalLogicProps): SafeDeleteModalLogicReturn {
    const mounted = useHasMounted()
    const shouldRender = isOpen && mounted
    const dialogRef = useRef<HTMLDialogElement>(null)
    const cancelButtonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const dialog = dialogRef.current
        if (!shouldRender || !dialog) return undefined

        const { ownerDocument } = dialog
        const trigger = ownerDocument.activeElement
        const style = ownerDocument.body.style
        const previousOverflow = style.overflow
        dialog.showModal()
        style.overflow = 'hidden'
        cancelButtonRef.current?.focus()

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
                if (!isConfirming) onClose()
            },
        },
        refs: { dialogRef, cancelButtonRef },
    }
}
