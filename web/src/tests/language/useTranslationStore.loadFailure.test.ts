import { afterEach, expect, it, mock } from 'bun:test'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

// Each failing switch uses its own locale because Bun caches a failed import.
for (const locale of ['pl', 'nl', 'it']) {
    void mock.module(`@/language/Locales/${locale}.json`, () => {
        throw new Error('Catalog unavailable')
    })
}

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

it('never persists a superseded or failed selection', async function () {
    const { getSnapshot, setLanguage } =
        await import('@/language/languageStore.ts')
    const { localStorage } = stubBrowserLanguage('de', 'en-US')
    await setLanguage('de')
    localStorage.setItem.mockClear()

    const currentGerman = setLanguage('de')
    const failingDutch = setLanguage('nl')
    await currentGerman
    await expect(failingDutch).rejects.toThrow()
    expect(localStorage.setItem.mock.calls).toEqual([['app-language', 'de']])

    const supersededFrench = setLanguage('fr')
    const failingItalian = setLanguage('it')
    await supersededFrench
    await expect(failingItalian).rejects.toThrow()

    expect(localStorage.setItem.mock.calls).toEqual([['app-language', 'de']])
    expect(getSnapshot().language).toBe('de')
})
