import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
    AVAILABLE_LANGUAGES,
    LANGUAGE_NATIVE_NAMES,
    FLAG_IMAGES,
} from '@/config/language.config.ts'
import {
    backendMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

const resourceSchema = z.object({
    language: z.record(z.string(), z.string()),
    marketplace: z.object({ tagline: z.string(), footerLanguage: z.string() }),
    auth: z.object({
        login: z.object({ login: z.string() }),
        register: z.object({ previewDescription: z.string() }),
    }),
})
function resource(value: unknown) {
    const imported = z.object({ default: resourceSchema }).safeParse(value)
    return imported.success
        ? imported.data.default
        : resourceSchema.parse(value)
}

describe('useTranslationStore resources', () => {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('loads genuine resources, native labels and flags for all eight supported languages', async () => {
        await import('@/language/useTranslationStore.ts')
        const english = resource(await backendMock.loader?.('en'))
        const resources = await Promise.all(
            AVAILABLE_LANGUAGES.map(async (language) => ({
                language,
                loaded: resource(await backendMock.loader?.(language)),
            })),
        )
        for (const { language, loaded } of resources) {
            expect(loaded.language[language]).toBe(
                LANGUAGE_NATIVE_NAMES[language],
            )
            expect(FLAG_IMAGES[language]).toBeTruthy()
            if (language !== 'en') {
                expect(loaded.marketplace.tagline).not.toBe(
                    english.marketplace.tagline,
                )
                expect(loaded.auth.login.login).not.toBe(
                    english.auth.login.login,
                )
                expect(loaded.auth.register.previewDescription).not.toBe(
                    english.auth.register.previewDescription,
                )
            }
        }
        const fallback = resource(await backendMock.loader?.('sv'))
        expect(fallback.language.de).toBe('Deutsch')
    })
})
