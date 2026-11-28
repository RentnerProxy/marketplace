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
    const itemSpacing = 'mx-3 gap-3 px-3'
    const focusStyle =
        'focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-proxy-300'

    if (item.children?.length) {
        return (
            <div className="space-y-1">
                <button
                    type="button"
                    onClick={() => onToggleGroup(navigationKey)}
                    aria-expanded={isOpen}
                    data-active={activeGroupKey === item.labelKey}
                    className={`comic-lettering group relative flex min-h-10 w-[calc(100%-1.5rem)] cursor-pointer items-center rounded-md text-xs text-mist-300 transition-colors hover:bg-white/10 hover:text-proxy-300 data-[active=true]:text-proxy-300 motion-reduce:transition-none ${itemSpacing} ${focusStyle}`}
                >
                    <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rotate-45 border-2 border-current group-data-[active=true]:bg-proxy-400"
                    />
                    <span className="min-w-0 flex-1 text-left">{label}</span>
                    <span
                        aria-hidden="true"
                        className="flex shrink-0 items-center gap-2 text-mist-400"
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
            className={`comic-lettering relative flex min-h-11 items-center rounded-md border-2 border-transparent text-sm text-mist-200 transition-[color,background-color,transform] hover:bg-white/10 hover:text-proxy-300 aria-[current=page]:-translate-x-px aria-[current=page]:-translate-y-px aria-[current=page]:border-ink aria-[current=page]:bg-proxy-400 aria-[current=page]:text-on-proxy aria-[current=page]:shadow-[3px_3px_0_0_white] motion-reduce:transition-none ${itemSpacing} ${focusStyle}`}
        >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span className="wrap-anywhere">{label}</span>
        </Link>
    )
}
