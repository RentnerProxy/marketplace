import type { UserSettingsModalLogicReturn } from '../Types/user-settings-logic.types.ts'
import { useEffect, useState } from 'react'
import useHasMounted from '@/shared/Hooks/useHasMounted.ts'
import type { UserSettingsTab } from '../Types/user-settings-domain.types.ts'
import useAuthenticatedShellUiStore from '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts'

export default function useUserSettingsModalLogic(): UserSettingsModalLogicReturn {
    const { state, handler } = useAuthenticatedShellUiStore()

    const mounted = useHasMounted()
    const [activeTab, setActiveTab] = useState<UserSettingsTab>('account')

    useEffect(() => {
        document.body.style.overflow = state.isUserSettingsOpen
            ? 'hidden'
            : 'unset'
        return () => {
            document.body.style.overflow = 'unset'
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
