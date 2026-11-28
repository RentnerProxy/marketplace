import type { SegmentedTabsProps } from '@/shared/Types/segmented-tabs.types.ts'

const columnClasses = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
} as const

export default function SegmentedTabs<TTab extends string>({
    activeTab,
    columns,
    onTabChange,
    tabs,
}: SegmentedTabsProps<TTab>) {
    return (
        <div
            className={`grid gap-2 rounded-lg border-2 border-border-dark bg-background-dark p-1.5 ${columnClasses[columns]}`}
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
                        className={`flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border-2 px-1 font-comic text-sm font-bold transition-[color,background-color,transform] sm:gap-2 sm:px-3 ${
                            isActive
                                ? 'comic-selected -translate-x-px -translate-y-px'
                                : 'border-transparent text-secondary-text hover:bg-input-dark hover:text-foreground'
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
