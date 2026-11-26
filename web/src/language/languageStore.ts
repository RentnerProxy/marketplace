import {
    AVAILABLE_LANGUAGES,
    FALLBACK_LANGUAGE,
} from '@/config/language.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import { createTranslator } from './translation.ts'
import type { Messages, Translate } from './translation.ts'

const storageKey = 'app-language'
const fallbackSnapshot = Object.freeze({
    language: FALLBACK_LANGUAGE,
    t: createTranslator(),
})
// English is the static fallback catalog; the other languages load on demand.
const lazyMessages: Record<
    AppLanguage,
    (() => Promise<{ default: Messages }>) | undefined
> = {
    en: undefined,
    de: () => import('./Locales/de.json'),
    es: () => import('./Locales/es.json'),
    fr: () => import('./Locales/fr.json'),
    it: () => import('./Locales/it.json'),
    pt: () => import('./Locales/pt.json'),
    nl: () => import('./Locales/nl.json'),
    pl: () => import('./Locales/pl.json'),
}

type BrowserStore = {
    snapshot: { language: AppLanguage; t: Translate }
    subscribers: Set<() => void>
    revision: number
}

let browserStore: BrowserStore | undefined

function isAppLanguage(value: unknown): value is AppLanguage {
    return AVAILABLE_LANGUAGES.some((language) => language === value)
}

// The Marketplace ignores the browser language and defaults to English.
function getStoredLanguage(): AppLanguage {
    try {
        const stored = window.localStorage.getItem(storageKey)
        if (isAppLanguage(stored)) return stored
    } catch {
        // Storage may be disabled in the browser.
    }

    return FALLBACK_LANGUAGE
}

async function loadTranslator(language: AppLanguage): Promise<Translate> {
    const load = lazyMessages[language]
    if (language === FALLBACK_LANGUAGE || !load) return fallbackSnapshot.t
    return createTranslator((await load()).default)
}

/** Resolves to true when this switch is the current language after loading. */
async function changeLanguage(
    store: BrowserStore,
    language: AppLanguage,
): Promise<boolean> {
    const revision = ++store.revision
    if (store.snapshot.language === language) return true

    const t = await loadTranslator(language)

    if (revision !== store.revision) return false

    store.snapshot = { language, t }
    window.document.documentElement.lang = language
    store.subscribers.forEach((subscriber) => subscriber())
    return true
}

function getBrowserStore(): BrowserStore {
    return (browserStore ??= {
        snapshot: fallbackSnapshot,
        subscribers: new Set(),
        revision: 0,
    })
}

export function getServerSnapshot() {
    return fallbackSnapshot
}

export function getSnapshot() {
    return typeof window === 'undefined'
        ? fallbackSnapshot
        : (browserStore?.snapshot ?? fallbackSnapshot)
}

export function subscribe(subscriber: () => void) {
    if (typeof window === 'undefined') return () => {}

    const store = getBrowserStore()
    store.subscribers.add(subscriber)
    if (store.revision === 0) {
        void changeLanguage(store, getStoredLanguage()).catch(() => {
            console.error('Language initialization failed.')
        })
    }

    return () => store.subscribers.delete(subscriber)
}

export async function setLanguage(language: AppLanguage) {
    if (typeof window === 'undefined' || !isAppLanguage(language)) return

    // Persist only a switch that loaded and was not superseded.
    if (!(await changeLanguage(getBrowserStore(), language))) return

    try {
        window.localStorage.setItem(storageKey, language)
    } catch {
        // Language changes still work when storage is disabled.
    }
}

export const translateCurrentLanguage: Translate = (key, values) =>
    getSnapshot().t(key, values)
