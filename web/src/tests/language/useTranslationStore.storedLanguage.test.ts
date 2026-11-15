import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import {
    i18nextMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore gespeicherte Sprache', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('übernimmt eine gespeicherte Sprache und synchronisiert DOM und Storage', async function () {
        const storage = {
            getItem: vi.fn(function () {
                return 'en'
            }),
            setItem: vi.fn(),
        }
        const documentElement = { lang: '' }
        stubTestGlobal('window', {
            localStorage: storage,
            navigator: { language: 'de-DE' },
        })
        stubTestGlobal('document', { documentElement })
        i18nextMock.api.resolvedLanguage = 'en'

        const useTranslationStore = (
            await import('@/language/useTranslationStore.ts')
        ).default
        const store = useTranslationStore()

        expect(documentElement.lang).toBe('en')
        expect(store.language).toBe('en')
        expect(store.t('common.save')).toBe('translated:common.save')

        await store.setLanguage('de')

        expect(storage.setItem).toHaveBeenCalledWith('app-language', 'de')
        expect(i18nextMock.api.changeLanguage).toHaveBeenCalledWith('de')
        expect(documentElement.lang).toBe('de')
    })
})
