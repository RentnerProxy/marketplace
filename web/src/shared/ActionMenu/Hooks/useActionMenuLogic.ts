import type { MenuItem } from '@rentnerkev/menu'
import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ActionMenuItem } from '../Types/action-menu.types.ts'

export default function useActionMenuLogic(actions: readonly ActionMenuItem[]) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const items = useMemo<readonly MenuItem[]>(
        () =>
            actions.map((action) => {
                const common = {
                    id: action.id,
                    label: action.label,
                    icon: action.icon,
                    ...(action.description === undefined
                        ? {}
                        : { description: action.description }),
                }

                if (action.href !== undefined) {
                    if (action.disabled) return { ...common, disabled: true }
                    return {
                        ...common,
                        type: 'link',
                        href: action.href,
                        ...(action.download === undefined
                            ? {}
                            : { download: action.download }),
                    }
                }

                return {
                    ...common,
                    disabled: Boolean(action.disabled),
                    danger: Boolean(action.destructive),
                }
            }),
        [actions],
    )

    return {
        state: { open, items },
        handler: {
            handleOpenChange: setOpen,
            handleAction: (id: string) => {
                const action = actions.find((item) => item.id === id)
                if (!action?.onSelect || action.disabled) return

                // Restore the row trigger before the next focus scope opens.
                flushSync(() => setOpen(false))
                triggerRef.current?.focus({ preventScroll: true })
                action.onSelect()
            },
        },
        refs: { triggerRef },
    }
}
