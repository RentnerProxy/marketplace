import type { Dispatch, SetStateAction } from 'react'
import type { UserSettingsTab } from './user-settings-domain.types.ts'

export type UserSettingsModalLogicReturn = {
    state: {
        activeTab: UserSettingsTab
        mounted: boolean
        isOpen: boolean
    }
    handler: { closeUserSettings: () => void }
    setter: { setActiveTab: Dispatch<SetStateAction<UserSettingsTab>> }
}
