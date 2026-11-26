import { afterEach, expect, it, vi } from 'bun:test'
import {
    getSnapshot,
    setLanguage,
    subscribe,
} from '@/language/languageStore.ts'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'
import { stubBrowserLanguage } from './useTranslationStoreTestHarness.ts'

afterEach(restoreTestGlobals)

it('keeps English for unsupported stored languages and ignores invalid switches', async function () {
    const { documentElement, localStorage } = stubBrowserLanguage('sv', 'de-DE')
    const subscriber = vi.fn()
    const unsubscribe = subscribe(subscriber)
    await Reflect.apply(setLanguage, undefined, ['sv'])

    expect(localStorage.getItem).toHaveBeenCalledWith('app-language')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(getSnapshot().language).toBe('en')
    expect(documentElement.lang).toBe('en')
    expect(subscriber).not.toHaveBeenCalled()
    unsubscribe()
})
