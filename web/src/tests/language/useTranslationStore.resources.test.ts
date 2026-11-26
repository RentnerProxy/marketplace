import { afterEach, describe, expect, it } from 'bun:test'
import {
    AVAILABLE_LANGUAGES,
    FLAG_IMAGES,
    LANGUAGE_NATIVE_NAMES,
} from '@/config/language.config.ts'
import en from '@/language/Locales/en.json'
import {
    getSnapshot,
    setLanguage,
    translateCurrentLanguage,
} from '@/language/languageStore.ts'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

describe('language resources', () => {
    it('loads genuine resources, native labels and flags for all eight supported languages', async () => {
        const { documentElement } = stubBrowserLanguage(null, 'en-US')

        for (const language of AVAILABLE_LANGUAGES) {
            // oxlint-disable-next-line no-await-in-loop -- Language switches must complete in order.
            await setLanguage(language)

            expect(getSnapshot().language).toBe(language)
            expect(documentElement.lang).toBe(language)
            expect(translateCurrentLanguage(`language.${language}`)).toBe(
                LANGUAGE_NATIVE_NAMES[language],
            )
            expect(FLAG_IMAGES[language]).toBeTruthy()
            if (language !== 'en') {
                expect(
                    translateCurrentLanguage('marketplace.tagline'),
                ).not.toBe(en.marketplace.tagline)
                expect(translateCurrentLanguage('auth.login.login')).not.toBe(
                    en.auth.login.login,
                )
                expect(
                    translateCurrentLanguage(
                        'auth.register.previewDescription',
                    ),
                ).not.toBe(en.auth.register.previewDescription)
            }
        }
    })
})
