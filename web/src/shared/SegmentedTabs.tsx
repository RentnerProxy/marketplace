import type { SegmentedTabsProps } from '@/shared/Types/segmented-tabs.types.ts'

const columnClasses = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
} as const

export default function SegmentedTabs<TTab extends string>({
    activeTab,
    columns,
    onTabChange,
    tabs,
}: SegmentedTabsProps<TTab>) {
    return (
        <div
            className={`grid gap-2 rounded-lg border border-border-dark bg-background-dark p-1 ${columnClasses[columns]}`}
        >
            {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.key

                return (
                    <button
                        key={tab.key}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => onTabChange(tab.key)}
                        title={tab.label}
                        className={`flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-sm font-semibold transition-colors sm:gap-2 sm:px-3 ${
                            isActive
                                ? 'bg-input-dark text-white shadow-[inset_0_-2px_0_var(--color-primary)]'
                                : 'text-secondary-text hover:bg-input-dark hover:text-white'
                        }`}
                    >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">{tab.label}</span>
                    </button>
                )
            })}
        </div>
    )
}
