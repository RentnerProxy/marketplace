import { afterEach, expect, it, vi } from 'bun:test'
import {
    getSnapshot,
    setLanguage,
    subscribe,
} from '@/language/languageStore.ts'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

it('uses English on a first visit from a German browser and ignores stale switches', async function () {
    const { documentElement, localStorage } = stubBrowserLanguage(null, 'de-DE')
    const subscriber = vi.fn()
    const unsubscribe = subscribe(subscriber)
    await Promise.resolve()

    expect(getSnapshot().language).toBe('en')
    expect(documentElement.lang).toBe('en')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(subscriber).not.toHaveBeenCalled()

    await setLanguage('de')
    subscriber.mockClear()

    const pendingFrench = setLanguage('fr')
    await setLanguage('de')
    await pendingFrench

    expect(getSnapshot().language).toBe('de')
    expect(documentElement.lang).toBe('de')
    expect(localStorage.setItem).toHaveBeenLastCalledWith('app-language', 'de')
    expect(subscriber).not.toHaveBeenCalled()
    unsubscribe()
})
