import { Palette, ShieldCheck, UserRound } from 'lucide-react'
import type { UserSettingsTabConfig } from '../Types/user-settings-domain.types.ts'
import type { UserSettingsTabsProps } from '../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import SegmentedTabs from '@/shared/SegmentedTabs.tsx'

const userSettingsTabs: Array<UserSettingsTabConfig> = [
    { key: 'account', labelKey: 'userSettings.account', icon: UserRound },
    { key: 'appearance', labelKey: 'userSettings.appearance', icon: Palette },
    {
        key: 'security',
        labelKey: 'userSettings.security.label',
        icon: ShieldCheck,
    },
]

export default function NavTabs({
    activeTab,
    onTabChange,
}: UserSettingsTabsProps) {
    const { t } = useTranslationStore()

    return (
        <div className="border-b border-border-dark px-6 py-3">
            <SegmentedTabs
                activeTab={activeTab}
                columns={3}
                onTabChange={onTabChange}
                tabs={userSettingsTabs.map((tab) => ({
                    icon: tab.icon,
                    key: tab.key,
                    label: t(tab.labelKey),
                }))}
            />
        </div>
    )
}
