import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import {
    i18nextMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore unbekannte Sprache', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('ignoriert unbekannte languageChanged-Werte für das DOM', async function () {
        const documentElement = { lang: 'de' }
        stubTestGlobal('window', {
            localStorage: { getItem: vi.fn(), setItem: vi.fn() },
            navigator: { language: 'de-DE' },
        })
        stubTestGlobal('document', { documentElement })

        await import('@/language/useTranslationStore.ts')
        i18nextMock.handlers.languageChanged?.('sv')

        expect(documentElement.lang).toBe('de')
    })
})
