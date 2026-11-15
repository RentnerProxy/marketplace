import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { ChevronDown } from 'lucide-react'
import type { NavigationItemProps } from '../Types/authenticated-layout-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'

export default function NavigationItem({
    item,
    depth = 0,
    navigationKey = item.to ?? item.labelKey,
    isCollapsed,
    openGroups,
}: NavigationItemProps) {
    const { t } = useTranslationStore()
    const { handler } = useAuthenticatedSidebarLogic()
    const Icon = item.icon
    const hasChildren = Boolean(item.children?.length)
    const label = t(item.labelKey)
    const isOpen = openGroups[navigationKey] ?? true
    const itemStyle = {
        paddingLeft: `${0.75 + depth * 1.5}rem`,
    }

    if (hasChildren) {
        const groupButton = (
            <button
                type="button"
                onClick={() => {
                    if (!isCollapsed) {
                        handler.handleToggleGroup(navigationKey)
                    }
                }}
                style={itemStyle}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-md pr-3 text-sm font-medium text-secondary-text transition-colors hover:bg-input-dark hover:text-white"
            >
                <Icon className="h-5 w-5 shrink-0" />
                {!isCollapsed && (
                    <>
                        <span className="min-w-0 flex-1 text-left">
                            {label}
                        </span>
                        <ChevronDown
                            className={`h-4 w-4 shrink-0 transition-transform ${
                                isOpen ? 'rotate-0' : '-rotate-90'
                            }`}
                        />
                    </>
                )}
            </button>
        )

        return (
            <div className="space-y-1">
                {isCollapsed ? (
                    <CustomTooltip side="right" content={label}>
                        {groupButton}
                    </CustomTooltip>
                ) : (
                    groupButton
                )}

                {!isCollapsed && isOpen && (
                    <div className="space-y-1">
                        {item.children?.map((child) => (
                            <NavigationItem
                                key={child.to ?? child.labelKey}
                                item={child}
                                depth={depth + 1}
                                navigationKey={`${navigationKey}.${child.to ?? child.labelKey}`}
                                isCollapsed={isCollapsed}
                                openGroups={openGroups}
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

    const navLink = (
        <Link
            to={item.to}
            preload={false}
            style={itemStyle}
            className="relative flex h-11 items-center gap-3 rounded-md pr-3 text-sm font-medium text-secondary-text transition-colors hover:bg-input-dark hover:text-white"
            activeProps={{
                className:
                    'bg-input-dark text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
            }}
        >
            <Icon className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>{label}</span>}
        </Link>
    )

    if (isCollapsed) {
        return (
            <CustomTooltip side="right" content={label}>
                {navLink}
            </CustomTooltip>
        )
    }

    return navLink
}
