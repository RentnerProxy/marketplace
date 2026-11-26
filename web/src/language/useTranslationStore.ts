import { useSyncExternalStore } from 'react'
import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import {
    getServerSnapshot,
    getSnapshot,
    setLanguage,
    subscribe,
} from './languageStore.ts'

export type { Translate, TranslationKey } from './translation.ts'

export default function useTranslationStore() {
    const { language, t } = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    )

    return {
        availableLanguages: AVAILABLE_LANGUAGES,
        language,
        setLanguage,
        t,
    }
}
