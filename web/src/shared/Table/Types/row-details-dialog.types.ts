import type { ReactNode } from 'react'

export type RowDetailsDialogProps = {
    title: string
    onClose: () => void
    closeDisabled?: boolean
    children: ReactNode
    footer?: ReactNode
}
