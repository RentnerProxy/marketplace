import type { LanguageSettingsLogicReturn } from '../Types/language-logic.types.ts'
import { useState } from 'react'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useLanguageSettingsLogic(): LanguageSettingsLogicReturn {
    const { availableLanguages, language, setLanguage, t } =
        useTranslationStore()

    const [selectedLanguage, setSelectedLanguage] =
        useState<AppLanguage>(language)
    const [previousLanguage, setPreviousLanguage] =
        useState<AppLanguage>(language)
    const [isSavingLanguage, setIsSavingLanguage] = useState(false)

    const hasLanguageChanged = selectedLanguage !== language

    if (language !== previousLanguage) {
        setPreviousLanguage(language)
        setSelectedLanguage(language)
    }

    async function handleSaveLanguage() {
        if (!hasLanguageChanged || isSavingLanguage) {
            return
        }

        try {
            setIsSavingLanguage(true)
            await setLanguage(selectedLanguage)
            toast.success(t('language.savedDescription'), {
                title: t('language.savedTitle'),
            })
        } catch (error: unknown) {
            toastAppError(error)
        } finally {
            setIsSavingLanguage(false)
        }
    }

    return {
        state: {
            availableLanguages,
            selectedLanguage,
            hasLanguageChanged,
            isSavingLanguage,
        },
        handler: { handleSaveLanguage },
        setter: { setSelectedLanguage },
    }
}
