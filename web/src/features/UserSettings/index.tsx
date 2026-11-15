import { createPortal } from 'react-dom'
import Header from './Components/Header.tsx'
import NavTabs from './Components/NavTabs.tsx'
import useUserSettingsModalLogic from './Hooks/useUserSettingsModalLogic.ts'
import type { UserSettingsModalProps } from './Types/user-settings-component-props.types.ts'
import AccountSection from '@/features/UserSettings/Components/Account/index.tsx'
import AppearanceSection from '@/features/UserSettings/Components/AppearanceSection/index.tsx'
import SecuritySection from '@/features/UserSettings/Components/SecuritySection/index.tsx'

export default function UserSettingsModal({
    username,
}: UserSettingsModalProps) {
    const { state, handler, setter } = useUserSettingsModalLogic()

    if (!state.isOpen || !state.mounted) {
        return null
    }

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-background-dark/80 p-4 backdrop-blur-sm sm:p-6">
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-dark bg-surface-dark">
                <Header
                    username={username}
                    onClose={handler.closeUserSettings}
                />
                <NavTabs
                    activeTab={state.activeTab}
                    onTabChange={setter.setActiveTab}
                />

                <div className="min-h-0 space-y-5 overflow-y-auto p-6">
                    {state.activeTab === 'account' && <AccountSection />}

                    {state.activeTab === 'appearance' && <AppearanceSection />}

                    {state.activeTab === 'security' && <SecuritySection />}
                </div>
            </div>
        </div>,
        document.body,
    )
}
