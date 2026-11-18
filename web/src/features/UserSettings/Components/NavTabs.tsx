import { Palette, ShieldCheck, UserRound } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { UserSettingsTabConfig } from '../Types/user-settings-domain.types.ts'
import type { UserSettingsTabsProps } from '../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

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

    function handleTabKeyDown(
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) {
        const length = userSettingsTabs.length
        let nextIndex: number

        switch (event.key) {
            case 'ArrowLeft':
                nextIndex = (index + length - 1) % length
                break
            case 'ArrowRight':
                nextIndex = (index + 1) % length
                break
            case 'Home':
                nextIndex = 0
                break
            case 'End':
                nextIndex = length - 1
                break
            default:
                return
        }

        const nextTab = userSettingsTabs[nextIndex]
        if (!nextTab) return

        event.preventDefault()
        onTabChange(nextTab.key)
        event.currentTarget.ownerDocument
            .getElementById(`user-settings-tab-${nextTab.key}`)
            ?.focus()
    }

    return (
        <div
            role="tablist"
            aria-label={t('userSettings.header.title')}
            className="flex shrink-0 flex-wrap gap-1 border-b border-border-dark bg-(--marketplace-surface-subtle) px-5 py-2 sm:px-6"
        >
            {userSettingsTabs.map(({ key, labelKey, icon: Icon }, index) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`user-settings-tab-${key}`}
                    aria-controls={`user-settings-panel-${key}`}
                    aria-selected={key === activeTab}
                    tabIndex={key === activeTab ? 0 : -1}
                    onClick={() => onTabChange(key)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-extrabold text-secondary-text transition-colors hover:border-border-dark hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-selected:border-primary/20 aria-selected:bg-primary/10 aria-selected:text-primary-text motion-reduce:transition-none sm:min-h-12 sm:px-4"
                >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {t(labelKey)}
                </button>
            ))}
        </div>
    )
}
