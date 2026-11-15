import { useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { LANGUAGE_NATIVE_NAMES } from '@/config/language.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import type { LanguageSwitcherLogicReturn } from '../Types/language-switcher-logic.types.ts'

export default function useLanguageSwitcherLogic(): LanguageSwitcherLogicReturn {
    const { availableLanguages, language, setLanguage } = useTranslationStore()
    const [pendingLanguage, setPendingLanguage] = useState<AppLanguage | null>(null)
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
            language,
            options: availableLanguages.map((value) => ({ value, label: LANGUAGE_NATIVE_NAMES[value] })),
            isChangingLanguage,
        },
        handler: { handleLanguageChange },
    }
}
