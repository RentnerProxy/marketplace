import i18next, {
    changeLanguage,
    t as translate,
    use as useI18next,
} from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { useSyncExternalStore } from 'react'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import {
    AVAILABLE_LANGUAGES,
    FALLBACK_LANGUAGE,
} from '@/config/language.config.ts'

const LANGUAGE_RESOURCE_LOADERS: Record<AppLanguage, () => Promise<unknown>> = {
    de: () => import('@/language/Locales/de.json'),
    en: () => import('@/language/Locales/en.json'),
    es: () => import('@/language/Locales/es.json'),
    fr: () => import('@/language/Locales/fr.json'),
    it: () => import('@/language/Locales/it.json'),
    pt: () => import('@/language/Locales/pt.json'),
    nl: () => import('@/language/Locales/nl.json'),
    pl: () => import('@/language/Locales/pl.json'),
}

const subscribers = new Set<() => void>()
const availableLanguageSet = new Set<string>(AVAILABLE_LANGUAGES)

let resourceVersion = 0

function isAppLanguage(value: string | null | undefined): value is AppLanguage {
    return typeof value === 'string' && availableLanguageSet.has(value)
}

function getStoredLanguage(): AppLanguage {
    if (typeof window === 'undefined') {
        return FALLBACK_LANGUAGE
    }

    const storedLanguage = window.localStorage.getItem('app-language')

    if (isAppLanguage(storedLanguage)) {
        return storedLanguage
    }

    const browserLanguage = window.navigator.language.split('-')[0]

    if (isAppLanguage(browserLanguage)) {
        return browserLanguage
    }

    return FALLBACK_LANGUAGE
}

const initialLanguage = getStoredLanguage()

if (typeof document !== 'undefined') {
    document.documentElement.lang = initialLanguage
}

void useI18next(
    resourcesToBackend(function (language: string) {
        const loader = isAppLanguage(language)
            ? LANGUAGE_RESOURCE_LOADERS[language]
            : LANGUAGE_RESOURCE_LOADERS[FALLBACK_LANGUAGE]

        return loader()
    }),
)
    .init({
        lng: initialLanguage,
        fallbackLng: 'en',
        supportedLngs: AVAILABLE_LANGUAGES,
        interpolation: {
            escapeValue: false,
        },
    })
    .catch(() => {
        console.error('Language initialization failed.')
    })

function emitChange() {
    subscribers.forEach(function (subscriber) {
        subscriber()
    })
}

function emitResourceChange() {
    resourceVersion += 1
    emitChange()
}

i18next.on('initialized', emitResourceChange)
i18next.on('loaded', emitResourceChange)

i18next.on('languageChanged', function (language) {
    if (typeof document !== 'undefined' && isAppLanguage(language)) {
        document.documentElement.lang = language
    }

    emitChange()
})

function subscribe(subscriber: () => void) {
    subscribers.add(subscriber)

    return function unsubscribe() {
        subscribers.delete(subscriber)
    }
}

function getSnapshot() {
    return `${i18next.resolvedLanguage ?? FALLBACK_LANGUAGE}:${resourceVersion}`
}

async function setLanguage(language: AppLanguage) {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem('app-language', language)
    }

    await changeLanguage(language)
}

function t(key: string, options?: Record<string, unknown>): string {
    return translate(key, options ?? {})
}

export default function useTranslationStore() {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const language = snapshot.split(':')[0]

    return {
        availableLanguages: AVAILABLE_LANGUAGES,
        language: isAppLanguage(language) ? language : FALLBACK_LANGUAGE,
        setLanguage,
        t,
    }
}
