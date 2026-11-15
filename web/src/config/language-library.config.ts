import type { CalendarLocale } from '@rentnerkev/calendar'
import type { PickerLocale } from '@rentnerkev/picker'
import type { SelectLocale } from '@rentnerkev/select'
import type { ToastLocale } from '@rentnerkev/toasts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'

// These libraries currently ship German and English catalogs only.
const BILINGUAL_LOCALES = {
    en: 'en', de: 'de', es: 'en', fr: 'en', it: 'en', pt: 'en', nl: 'en', pl: 'en',
} as const satisfies Record<AppLanguage, 'en' | 'de'>

export const CALENDAR_LOCALES: Record<AppLanguage, CalendarLocale> = BILINGUAL_LOCALES
export const PICKER_LOCALES: Record<AppLanguage, PickerLocale> = BILINGUAL_LOCALES
export const TOAST_LOCALES: Record<AppLanguage, ToastLocale> = BILINGUAL_LOCALES

export const SELECT_LOCALES: Record<AppLanguage, SelectLocale> = {
    en: 'en', de: 'de', es: 'es', fr: 'fr', it: 'en', pt: 'en', nl: 'en', pl: 'en',
}
