import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import {
    i18nextMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore English default', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('uses English on a first visit from a German browser', async function () {
        const storage = {
            getItem: vi.fn(function () {
                return null
            }),
            setItem: vi.fn(),
        }
        stubTestGlobal('window', {
            localStorage: storage,
            navigator: { language: 'de-DE' },
        })
        stubTestGlobal('document', { documentElement: { lang: '' } })

        await import('@/language/useTranslationStore.ts')

        expect(i18nextMock.api.init).toHaveBeenCalledWith(
            expect.objectContaining({ lng: 'en' }),
        )
        expect(document.documentElement.lang).toBe('en')
        expect(storage.setItem).not.toHaveBeenCalled()
    })
})
