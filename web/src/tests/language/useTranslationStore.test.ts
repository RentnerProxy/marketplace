import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    backendMock,
    i18nextMock,
    reactMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore serverseitig', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('verwendet serverseitig die Fallback-Sprache und benachrichtigt Subscriber', async function () {
        const useTranslationStore = (
            await import('@/language/useTranslationStore.ts')
        ).default

        const store = useTranslationStore()
        const subscriber = vi.fn()
        const unsubscribe = reactMock.subscribe?.(subscriber)

        expect(store.language).toBe('de')
        expect(store.availableLanguages).toEqual(['en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl'])
        const options = { count: 2, name: 'Österreich' }
        const translation: string = store.t('example.key', options)
        expect(translation).toBe('translated:example.key')
        expect(i18nextMock.api.t).toHaveBeenCalledWith('example.key', options)
        expect(i18nextMock.api.init).toHaveBeenCalledWith(
            expect.objectContaining({
                lng: 'de',
                fallbackLng: 'en',
                supportedLngs: ['en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl'],
                interpolation: { escapeValue: false },
            }),
        )
        expect(i18nextMock.api.use).toHaveBeenCalledWith(backendMock.backend)

        i18nextMock.handlers.initialized?.()
        i18nextMock.handlers.loaded?.()
        expect(subscriber).toHaveBeenCalledTimes(2)
        expect(reactMock.getSnapshot?.()).toBe('de:2')

        unsubscribe?.()
        i18nextMock.handlers.loaded?.()
        expect(subscriber).toHaveBeenCalledTimes(2)
    })
})
