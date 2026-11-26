import { expect, test } from 'bun:test'
import { z } from 'zod'
import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import {
    CALENDAR_LOCALES,
    PICKER_LOCALES,
    SELECT_LOCALES,
    TOAST_LOCALES,
} from '@/config/language-library.config.ts'
import { createTranslator, isTranslationKey } from '@/language/translation.ts'

function flatten(value: unknown, path = ''): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, item] of Object.entries(
        z.record(z.string(), z.unknown()).parse(value),
    )) {
        const child = path ? path + '.' + key : key
        if (typeof item === 'string') result[child] = item
        else Object.assign(result, flatten(item, child))
    }
    return result
}
const documents = Object.fromEntries(
    await Promise.all(
        AVAILABLE_LANGUAGES.map(async (language) => [
            language,
            await Bun.file(
                new URL(
                    '../../language/Locales/' + language + '.json',
                    import.meta.url,
                ),
            ).json(),
        ]),
    ),
)
const english = flatten(documents.en)

test('every advertised language covers public/account/shared labels and preserves interpolation tokens', () => {
    const publicKeys = Object.keys(english).filter((key) =>
        /^(auth|marketplace|common|nav|language|layout)\./.test(key),
    )
    for (const language of AVAILABLE_LANGUAGES) {
        const entries = flatten(documents[language])
        for (const key of publicKeys) expect(entries[key]).toBeTruthy()
        for (const [key, value] of Object.entries(entries)) {
            expect(english[key]).toBeDefined()
            expect(
                [...value.matchAll(/{{.*?}}/g)]
                    .map((match) => match[0])
                    .toSorted(),
            ).toEqual(
                [...(english[key] ?? '').matchAll(/{{.*?}}/g)]
                    .map((match) => match[0])
                    .toSorted(),
            )
        }
    }
})

test('untranslated inherited administrative details fall back explicitly to English', () => {
    const spanish = flatten(documents.es)
    const fallbackKey = Object.keys(english).find(
        (key) => key.startsWith('admin.') && spanish[key] === undefined,
    )
    expect(fallbackKey).toBeDefined()
    if (!fallbackKey || !isTranslationKey(fallbackKey))
        throw new Error('Expected a documented administrative fallback')
    const t = createTranslator(documents.es)
    expect(t(fallbackKey)).toBe(english[fallbackKey])
    expect(t('marketplace.tagline')).toBe(spanish['marketplace.tagline'])
})

test('library locale adapters only select catalogs actually shipped by each package', () => {
    for (const language of AVAILABLE_LANGUAGES) {
        const bilingual = language === 'de' ? 'de' : 'en'
        expect(CALENDAR_LOCALES[language]).toBe(bilingual)
        expect(PICKER_LOCALES[language]).toBe(bilingual)
        expect(TOAST_LOCALES[language]).toBe(bilingual)
        expect(SELECT_LOCALES[language]).toBe(
            language === 'de' || language === 'es' || language === 'fr'
                ? language
                : 'en',
        )
    }
})
