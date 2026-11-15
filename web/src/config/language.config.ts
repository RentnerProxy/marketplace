import type { AppLanguage } from '@/shared/Types/config.types.ts'
import germanFlag from '@/assets/flags/de.webp'
import englishFlag from '@/assets/flags/en.webp'
import spanishFlag from '@/assets/flags/es.svg'
import frenchFlag from '@/assets/flags/fr.svg'
import italianFlag from '@/assets/flags/it.svg'
import portugueseFlag from '@/assets/flags/pt.svg'
import dutchFlag from '@/assets/flags/nl.svg'
import polishFlag from '@/assets/flags/pl.svg'

export const FALLBACK_LANGUAGE: AppLanguage = 'de'

export const AVAILABLE_LANGUAGES = [
    'en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl',
] as const satisfies ReadonlyArray<AppLanguage>

export const LANGUAGE_NATIVE_NAMES: Record<AppLanguage, string> = {
    en: 'English',
    de: 'Deutsch',
    es: 'Español',
    fr: 'Français',
    it: 'Italiano',
    pt: 'Português',
    nl: 'Nederlands',
    pl: 'Polski',
}

export const FLAG_IMAGES: Record<AppLanguage, string> = {
    en: englishFlag,
    de: germanFlag,
    es: spanishFlag,
    fr: frenchFlag,
    it: italianFlag,
    pt: portugueseFlag,
    nl: dutchFlag,
    pl: polishFlag,
}
