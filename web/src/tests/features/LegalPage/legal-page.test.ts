import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { legalContent, legalOperator } from '@/features/LegalPage/legal-content.ts'
import type { LegalPageKind } from '@/features/LegalPage/Types/legal-content.types.ts'

let language = 'de'
vi.mock('@/language/useTranslationStore.ts', () => ({ default: () => ({ language }) }))
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => createElement('a', { ...props, href: to }),
}))

import LegalPage from '@/features/LegalPage/index.tsx'

describe('marketplace legal content', function () {
    it.each(['de', 'en', 'es', 'fr', 'pt', 'zh', 'ru', 'ar'])(
        'preserves the source operator and renders legal content with English fallback for %s',
        function (locale) {
            language = locale
            for (const kind of ['imprint', 'privacy'] satisfies LegalPageKind[]) {
                const html = renderToStaticMarkup(createElement(LegalPage, { kind }))
                const expected = legalContent[locale === 'de' ? 'de' : 'en'][kind]
                expect(html).toContain(expected.title)
                expect(html).toContain(`<article lang="${locale === 'de' ? 'de' : 'en'}"`)
                expect(html).toContain(legalOperator.name)
                expect(html).toContain(legalOperator.address)
                expect(html).toContain(`mailto:${legalOperator.email}`)
                expect(html).toContain(kind === 'imprint' ? 'href="/privacy"' : 'href="/imprint"')
                expect(html).not.toContain('{{')
                expect(html).not.toContain('auth.privacy.placeholder')
            }
        },
    )

    it.each(['de', 'en'] as const)(
        'documents implemented authentication and browser storage without copying landing-only processing claims in %s',
        function (locale) {
            const content = legalContent[locale].privacy.sections.flatMap(section => section.body).join('\n')
            for (const key of ['session_id', 'trusted_device_token', 'login_recovery', 'app-language']) {
                expect(content).toContain(key)
            }
            expect(content).not.toContain('Discord')
            expect(content).not.toContain('3 Dateien')
            expect(content).not.toContain('3 files')
            expect(content).toContain(locale === 'de' ? 'deaktivierte Vorschau' : 'disabled preview')
        },
    )
})
