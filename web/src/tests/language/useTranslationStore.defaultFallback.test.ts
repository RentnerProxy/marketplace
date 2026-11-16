import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import {
    i18nextMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore Standard-Fallback', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('uses English when storage is unsupported despite a German browser', async function () {
        const storage = {
            getItem: vi.fn(function () {
                return 'sv'
            }),
            setItem: vi.fn(),
        }
        stubTestGlobal('window', {
            localStorage: storage,
            navigator: { language: 'de-DE' },
        })
        stubTestGlobal('document', { documentElement: { lang: '' } })

        await import('@/language/useTranslationStore.ts')

        expect(i18nextMock.api.init).toHaveBeenLastCalledWith(
            expect.objectContaining({ lng: 'en' }),
        )
    })
})
