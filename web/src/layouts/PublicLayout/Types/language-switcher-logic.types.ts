import type { Option } from '@rentnerkev/select'
import type { AppLanguage } from '@/shared/Types/config.types.ts'

export type LanguageSwitcherLogicReturn = {
    state: {
        language: AppLanguage
        options: ReadonlyArray<Option<AppLanguage>>
        isChangingLanguage: boolean
    }
    handler: {
        handleLanguageChange: (language: AppLanguage) => Promise<void>
    }
}
