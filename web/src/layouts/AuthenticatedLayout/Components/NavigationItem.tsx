import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import type { NavigationItemProps } from '../Types/authenticated-layout-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function NavigationItem({
    item,
    navigationKey = item.to ?? item.labelKey,
    activeGroupKey,
    openGroups,
    onToggleGroup,
    onNavigate,
}: NavigationItemProps) {
    const { t } = useTranslationStore()
    const Icon = item.icon
    const label = t(item.labelKey)
    const isOpen = openGroups[navigationKey] ?? true
    const itemSpacing = 'gap-2.5 px-3.5 lg:pr-14 lg:pl-[2.2rem]'
    const focusStyle =
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'

    if (item.children?.length) {
        return (
            <div className="space-y-1">
                <button
                    type="button"
                    onClick={() => onToggleGroup(navigationKey)}
                    aria-expanded={isOpen}
                    data-active={activeGroupKey === item.labelKey}
                    className={`group relative flex min-h-11 w-full cursor-pointer items-center border-y border-transparent bg-white/[0.025] font-(family-name:--marketplace-mono) text-[0.67rem] font-bold tracking-[0.09em] text-[#c1d2c9] uppercase transition-colors before:absolute before:top-1/2 before:left-1 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-white/20 hover:border-white/10 hover:bg-white/[0.055] hover:text-[#f4f5f7] data-[active=true]:border-primary/20 data-[active=true]:bg-primary/12 data-[active=true]:text-primary data-[active=true]:before:bg-primary motion-reduce:transition-none ${itemSpacing} ${focusStyle}`}
                >
                    <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-[#9fb5a9]/70 group-data-[active=true]:bg-primary group-data-[active=true]:shadow-[0_0_8px_var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1 text-left">{label}</span>
                    <span
                        aria-hidden="true"
                        className="flex shrink-0 items-center gap-2 text-[#9fb5a9]"
                    >
                        <span className="tabular-nums">
                            {item.children.length}
                        </span>
                        <ChevronDown
                            className={`size-3.5 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                        />
                    </span>
                </button>

                {isOpen && (
                    <div className="space-y-[0.2rem]">
                        {item.children.map((child) => (
                            <NavigationItem
                                key={child.to ?? child.labelKey}
                                item={child}
                                navigationKey={`${navigationKey}.${child.to ?? child.labelKey}`}
                                activeGroupKey={activeGroupKey}
                                openGroups={openGroups}
                                onToggleGroup={onToggleGroup}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </div>
                )}
            </div>
        )
    }

    if (!item.to) {
        return null
    }

    return (
        <Link
            to={item.to}
            preload={false}
            onClick={onNavigate}
            className={`relative flex min-h-11 items-center border-y border-transparent py-[0.72rem] text-[0.85rem] font-[750] text-[#c1d2c9] transition-colors before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full hover:border-white/10 hover:bg-white/[0.055] hover:text-[#f4f5f7] aria-[current=page]:border-primary/20 aria-[current=page]:bg-primary/12 aria-[current=page]:text-[#f4f5f7] aria-[current=page]:before:bg-primary motion-reduce:transition-none ${itemSpacing} ${focusStyle}`}
        >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="wrap-anywhere">{label}</span>
        </Link>
    )
}
