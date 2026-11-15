import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'

let language: 'de' | 'en' = 'de'
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t(key: string) {
            const translation = language === 'de' ? de : en
            const value = key
                .split('.')
                .reduce<unknown>(
                    (current, part) =>
                        typeof current === 'object' && current !== null
                            ? Reflect.get(current, part)
                            : undefined,
                    translation,
                )
            return typeof value === 'string' ? value : key
        },
    }),
}))

import SetupAccessNotice from '@/features/Auth/FirstSuperUser/Components/SetupAccessNotice.tsx'

describe('Hinweis auf den Setup-Link in den App-Logs', function () {
    it.each(['de', 'en'] as const)(
        'führt zu den lokalen Terminal- oder Komodo-Logs in %s',
        function (locale) {
            language = locale
            const translation = locale === 'de' ? de : en
            const html = renderToStaticMarkup(
                createElement(SetupAccessNotice, { isChecking: false }),
            )

            expect(html).toContain(
                translation.auth.firstSetup.setupLinkRequired,
            )
            expect(html).toContain('bun run dev')
            expect(html).toContain('Komodo')
            expect(html).toContain('app')
            expect(html).toContain(locale === 'de' ? 'Browser' : 'browser')
            expect(html).not.toContain('setup:url')
            expect(html).not.toContain('<code')
        },
    )

    it.each(['de', 'en'] as const)(
        'behält während der Prüfung den Ladehinweis in %s',
        function (locale) {
            language = locale
            const translation = locale === 'de' ? de : en
            const html = renderToStaticMarkup(
                createElement(SetupAccessNotice, { isChecking: true }),
            )

            expect(html).toContain(
                translation.auth.firstSetup.checkingSetupLink,
            )
            expect(html).not.toContain('Komodo')
        },
    )
})
