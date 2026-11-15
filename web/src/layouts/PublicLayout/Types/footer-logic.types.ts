import type { AppLanguage } from '@/shared/Types/config.types.ts'

export type FooterLogicReturn = {
    state: {
        appVersion: string
        availableLanguages: readonly AppLanguage[]
        companyName: string
        currentYear: number
        isChangingLanguage: boolean
        language: AppLanguage
    }
    handler: {
        handleLanguageChange: (language: AppLanguage) => Promise<void>
    }
}
