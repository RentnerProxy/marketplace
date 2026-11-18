import { createPortal } from 'react-dom'
import Header from './Components/Header.tsx'
import NavTabs from './Components/NavTabs.tsx'
import useUserSettingsModalLogic from './Hooks/useUserSettingsModalLogic.ts'
import type { UserSettingsModalProps } from './Types/user-settings-component-props.types.ts'
import AccountSection from '@/features/UserSettings/Components/Account/index.tsx'
import AppearanceSection from '@/features/UserSettings/Components/AppearanceSection/index.tsx'
import SecuritySection from '@/features/UserSettings/Components/SecuritySection/index.tsx'

const settingsSections = {
    account: AccountSection,
    appearance: AppearanceSection,
    security: SecuritySection,
}

export default function UserSettingsModal({
    username,
}: UserSettingsModalProps) {
    const { state, handler, setter } = useUserSettingsModalLogic()

    if (!state.isOpen || !state.mounted) {
        return null
    }

    return createPortal(
        <div className="marketplace-signed-in fixed inset-0 z-100 flex items-center justify-center bg-marketplace-void/70 p-2 backdrop-blur-[2px] sm:p-6">
            <div className="marketplace-dialog-panel flex h-[min(44rem,calc(100dvh-1rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark text-foreground sm:h-[min(44rem,calc(100dvh-3rem))]">
                <Header
                    username={username}
                    onClose={handler.closeUserSettings}
                />
                <NavTabs
                    activeTab={state.activeTab}
                    onTabChange={setter.setActiveTab}
                />

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                    {Object.entries(settingsSections).map(([tab, Section]) => (
                        <div
                            key={tab}
                            role="tabpanel"
                            id={`user-settings-panel-${tab}`}
                            aria-labelledby={`user-settings-tab-${tab}`}
                            tabIndex={0}
                            hidden={state.activeTab !== tab}
                        >
                            {state.activeTab === tab && <Section />}
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    )
}
