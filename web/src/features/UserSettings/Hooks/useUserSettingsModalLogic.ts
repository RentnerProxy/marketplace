import type { UserSettingsModalLogicReturn } from '../Types/user-settings-logic.types.ts'
import { startTransition, useEffect, useState } from 'react'
import useHasMounted from '@/shared/Hooks/useHasMounted.ts'
import type { UserSettingsTab } from '../Types/user-settings-domain.types.ts'
import useAuthenticatedShellUiStore from '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useUserSettingsModalLogic(): UserSettingsModalLogicReturn {
    const { state, handler } = useAuthenticatedShellUiStore()
    const { t } = useTranslationStore()
    const openUserSettings = handler.openUserSettings

    const mounted = useHasMounted()
    const [activeTab, setActiveTab] = useState<UserSettingsTab>('account')

    useEffect(() => {
        if (window.location.hash !== '#social-linked') return
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${window.location.search}`,
        )
        startTransition(() => setActiveTab('security'))
        openUserSettings()
        toast.success(t('userSettings.security.socialAccounts.linked'))
    }, [openUserSettings, t])

    useEffect(() => {
        if (!state.isUserSettingsOpen) {
            return undefined
        }

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [state.isUserSettingsOpen])

    return {
        state: {
            activeTab,
            mounted,
            isOpen: state.isUserSettingsOpen,
        },
        setter: { setActiveTab },
        handler: {
            closeUserSettings: handler.closeUserSettings,
        },
    }
}
