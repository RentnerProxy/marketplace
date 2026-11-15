import { Layers3, ShieldCheck, Users } from 'lucide-react'
import SegmentedTabs from '@/shared/SegmentedTabs.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { SegmentedTabOption } from '@/shared/Types/segmented-tabs.types.ts'
import type { PermissionManagementTab } from '../Types/permission-management-domain.types.ts'
import type { PermissionManagementTabsProps } from '../Types/permission-management-component-props.types.ts'

export default function PermissionManagementTabs({
    activeTab,
    onTabChange,
}: PermissionManagementTabsProps) {
    const { t } = useTranslationStore()
    const tabs: Array<SegmentedTabOption<PermissionManagementTab>> = [
        {
            key: 'defaults',
            label: t('admin.permissions.tabs.defaults'),
            icon: ShieldCheck,
        },
        {
            key: 'presets',
            label: t('admin.permissions.tabs.presets'),
            icon: Layers3,
        },
        {
            key: 'users',
            label: t('admin.permissions.tabs.users'),
            icon: Users,
        },
    ]

    return (
        <SegmentedTabs
            activeTab={activeTab}
            columns={3}
            tabs={tabs}
            onTabChange={onTabChange}
        />
    )
}
