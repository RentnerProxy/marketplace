import type { ReactNode } from 'react'

type ActionMenuItemBase = {
    readonly id: string
    readonly label: string
    readonly description?: string
    readonly disabled?: boolean
    readonly icon?: ReactNode
}

export type ActionMenuItem = ActionMenuItemBase &
    (
        | {
              readonly onSelect: () => void
              readonly destructive?: boolean
              readonly href?: never
          }
        | {
              readonly href: string
              readonly download?: boolean | string
              readonly onSelect?: never
          }
    )

export type ActionMenuProps = {
    readonly items: readonly ActionMenuItem[]
    readonly ariaLabel?: string
}
