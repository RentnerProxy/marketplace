import { Menu } from '@rentnerkev/menu'
import { EllipsisVertical } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useActionMenuLogic from './Hooks/useActionMenuLogic.ts'
import type { ActionMenuProps } from './Types/action-menu.types.ts'

export function ActionMenu({ items, ariaLabel }: ActionMenuProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { triggerRef },
    } = useActionMenuLogic(items)
    if (!state.items.length) return null

    return (
        <Menu
            asChild
            ariaLabel={ariaLabel ?? t('common.openActions')}
            items={state.items}
            open={state.open}
            onOpenChange={handler.handleOpenChange}
            onAction={handler.handleAction}
            openOnHover
            align="end"
            sideOffset={6}
            collisionPadding={8}
            portalZIndex={90}
            triggerRef={triggerRef}
            trigger={
                <button type="button">
                    <EllipsisVertical
                        aria-hidden="true"
                        className="size-5"
                        strokeWidth={2}
                    />
                </button>
            }
            classNames={{
                trigger:
                    'marketplace-action-trigger inline-flex shrink-0 cursor-pointer items-center justify-center border border-transparent text-secondary-text transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none',
                content: 'marketplace-action-menu',
                item: 'transition-colors aria-disabled:pointer-events-none aria-disabled:opacity-45 motion-reduce:transition-none',
                icon: 'shrink-0 [&_svg]:size-4',
                label: 'font-bold leading-snug',
                description: 'font-normal leading-snug',
                indicator: 'hidden',
            }}
        />
    )
}
