import { afterEach, expect, it, vi } from 'bun:test'
import {
    getServerSnapshot,
    getSnapshot,
    setLanguage,
    subscribe,
    translateCurrentLanguage,
} from '@/language/languageStore.ts'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

it('loads the saved preference after the initial English snapshot and syncs subscribers and storage', async function () {
    const { documentElement, localStorage } = stubBrowserLanguage('de', 'en-US')
    expect(getSnapshot()).toBe(getServerSnapshot())
    expect(translateCurrentLanguage('common.save')).toBe('Save')

    const { promise, resolve } = Promise.withResolvers<void>()
    const subscriber = vi.fn(resolve)
    const unsubscribe = subscribe(subscriber)
    expect(getSnapshot()).toBe(getServerSnapshot())
    await promise

    expect(getSnapshot().language).toBe('de')
    expect(translateCurrentLanguage('common.save')).toBe('Speichern')
    expect(getServerSnapshot().t('common.save')).toBe('Save')
    expect(documentElement.lang).toBe('de')
    expect(localStorage.setItem).not.toHaveBeenCalled()

    await setLanguage('en')
    expect(documentElement.lang).toBe('en')
    expect(localStorage.setItem).toHaveBeenLastCalledWith('app-language', 'en')
    expect(subscriber).toHaveBeenCalledTimes(2)

    unsubscribe()
    await setLanguage('de')
    expect(subscriber).toHaveBeenCalledTimes(2)
})
