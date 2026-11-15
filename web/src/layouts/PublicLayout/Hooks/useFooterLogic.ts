import type { FooterLogicReturn } from '../Types/footer-logic.types.ts'
import { useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useFooterLogic(): FooterLogicReturn {
    const { availableLanguages, language, setLanguage } = useTranslationStore()
    const [currentYear] = useState(() => new Date().getFullYear())
    const [pendingLanguage, setPendingLanguage] = useState<AppLanguage | null>(
        null,
    )
    const isChangingLanguage = pendingLanguage !== null

    async function handleLanguageChange(nextLanguage: AppLanguage) {
        if (nextLanguage === language || isChangingLanguage) return

        try {
            setPendingLanguage(nextLanguage)
            await setLanguage(nextLanguage)
        } catch (error: unknown) {
            toastAppError(error)
        } finally {
            setPendingLanguage(null)
        }
    }

    return {
        state: {
            appVersion: import.meta.env.VITE_APP_VERSION || 'Dev',
            availableLanguages,
            companyName: PROJECT_CONFIG.defaultName,
            currentYear,
            isChangingLanguage,
            language,
        },
        handler: { handleLanguageChange },
    }
}
