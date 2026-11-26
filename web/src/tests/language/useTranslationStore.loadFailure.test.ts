import { afterEach, expect, it, mock } from 'bun:test'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

void mock.module('@/language/Locales/pl.json', () => {
    throw new Error('Catalog unavailable')
})

it('keeps the stored preference and the active language when a catalog fails to load', async function () {
    const { getSnapshot, setLanguage } =
        await import('@/language/languageStore.ts')
    const { documentElement, localStorage } = stubBrowserLanguage(null, 'en-US')

    await expect(setLanguage('pl')).rejects.toThrow()

    expect(getSnapshot().language).toBe('en')
    expect(documentElement.lang).toBe('en')
    expect(localStorage.setItem).not.toHaveBeenCalled()

    await setLanguage('de')
    expect(getSnapshot().language).toBe('de')
    expect(localStorage.setItem).toHaveBeenLastCalledWith('app-language', 'de')
})
