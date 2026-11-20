import type { RefObject, SyntheticEvent } from 'react'

export type UseModalDialogLogicProps = {
    isOpen: boolean
    closeDisabled: boolean
    onClose: () => void
}

export type ModalDialogLogicReturn = {
    state: { shouldRender: boolean }
    handler: {
        handleCancel: (event: SyntheticEvent<HTMLDialogElement>) => void
    }
    refs: {
        dialogRef: RefObject<HTMLDialogElement | null>
        closeButtonRef: RefObject<HTMLButtonElement | null>
    }
}
