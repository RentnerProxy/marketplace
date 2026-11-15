import type { AppLanguage } from '@/shared/Types/config.types.ts'
import germanFlag from '@/assets/flags/de.webp'
import englishFlag from '@/assets/flags/en.webp'

export const FALLBACK_LANGUAGE: AppLanguage = 'de'

export const AVAILABLE_LANGUAGES = [
    'de',
    'en',
] as const satisfies ReadonlyArray<AppLanguage>

export const FLAG_IMAGES: Record<AppLanguage, string> = {
    de: germanFlag,
    en: englishFlag,
}
