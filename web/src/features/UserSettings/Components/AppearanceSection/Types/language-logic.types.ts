import type { Dispatch, SetStateAction } from 'react'
import type { AppLanguage } from '@/shared/Types/config.types.ts'

export type LanguageSettingsLogicReturn = {
    state: {
        availableLanguages: ReadonlyArray<AppLanguage>
        selectedLanguage: AppLanguage
        hasLanguageChanged: boolean
        isSavingLanguage: boolean
    }
    handler: { handleSaveLanguage: () => Promise<void> }
    setter: { setSelectedLanguage: Dispatch<SetStateAction<AppLanguage>> }
}
