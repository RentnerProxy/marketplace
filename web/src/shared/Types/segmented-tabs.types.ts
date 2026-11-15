import type { LucideIcon } from 'lucide-react'

export type SegmentedTabOption<TTab extends string> = {
    key: TTab
    label: string
    icon: LucideIcon
}

export type SegmentedTabsProps<TTab extends string> = {
    activeTab: TTab
    columns: 2 | 3
    onTabChange: (tab: TTab) => void
    tabs: Array<SegmentedTabOption<TTab>>
}
