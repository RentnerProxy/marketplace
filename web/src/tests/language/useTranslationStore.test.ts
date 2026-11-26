import { describe, expect, expectTypeOf, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/language/Locales/en.json'
import { setLanguage } from '@/language/languageStore.ts'
import { createTranslator, isTranslationKey } from '@/language/translation.ts'
import type { TranslationKey } from '@/language/translation.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

function SaveLabel() {
    const { availableLanguages, language, t } = useTranslationStore()
    expect(availableLanguages).toEqual([
        'en',
        'de',
        'es',
        'fr',
        'it',
        'pt',
        'nl',
        'pl',
    ])
    return createElement('span', { lang: language }, t('common.save'))
}

describe('Translations', function () {
    it('accepts only leaf keys of the English catalog', function () {
        expectTypeOf<'common.save'>().toExtend<TranslationKey>()
        expectTypeOf<'common'>().not.toExtend<TranslationKey>()
        expectTypeOf<'common.unknown'>().not.toExtend<TranslationKey>()
    })

    it('renders English immediately without mutating the language between requests', async function () {
        const markup = '<span lang="en">Save</span>'
        expect(renderToStaticMarkup(createElement(SaveLabel))).toBe(markup)

        await setLanguage('de')

        expect(renderToStaticMarkup(createElement(SaveLabel))).toBe(markup)
    })

    it('interpolates raw values, preserves absent placeholders and falls back to English', function () {
        const t = createTranslator({
            common: { save: 'Speichern' },
            auth: {
                passwordPolicy: 'Zwischen {{min}} und {{max}} Zeichen.',
            },
        })

        expect(t('common.save')).toBe('Speichern')
        expect(t('common.cancel')).toBe(en.common.cancel)
        expect(t('auth.passwordPolicy', { min: '<1> {{max}}' })).toBe(
            'Zwischen <1> {{max}} und {{max}} Zeichen.',
        )
        expect(t('auth.passwordPolicy', { min: 0, max: 10 })).toBe(
            'Zwischen 0 und 10 Zeichen.',
        )
        expect(createTranslator()('auth.passwordPolicy', { min: 8 })).toBe(
            'The password must contain between 8 and {{max}} characters.',
        )
    })

    it('recognizes only own translation paths', function () {
        expect(isTranslationKey('common.save')).toBe(true)
        expect(isTranslationKey('common.constructor.name')).toBe(false)
        expect(isTranslationKey('common.toString')).toBe(false)
    })
})
