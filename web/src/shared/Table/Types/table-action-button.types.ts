import type { ReactNode } from 'react'

export type TableActionButtonProps = {
    ariaLabel: string
    children: ReactNode
    className: string
    disabled: boolean
    onClick: () => void
    tooltip: string
}
