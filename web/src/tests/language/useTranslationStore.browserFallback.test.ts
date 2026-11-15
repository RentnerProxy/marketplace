import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import {
    i18nextMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore Browser-Fallback', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('fällt bei ungültigem Storage auf die Browser-Sprache zurück', async function () {
        const storage = {
            getItem: vi.fn(function () {
                return 'sv'
            }),
            setItem: vi.fn(),
        }
        stubTestGlobal('window', {
            localStorage: storage,
            navigator: { language: 'en-US' },
        })
        stubTestGlobal('document', { documentElement: { lang: '' } })

        await import('@/language/useTranslationStore.ts')

        expect(i18nextMock.api.init).toHaveBeenCalledWith(
            expect.objectContaining({ lng: 'en' }),
        )
    })
})
