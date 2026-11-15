import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    backendMock,
    resetLanguageTestHarness,
    restoreLanguageTestHarness,
} from './useTranslationStoreTestHarness.ts'

describe('useTranslationStore Ressourcen', function () {
    beforeEach(resetLanguageTestHarness)
    afterEach(restoreLanguageTestHarness)

    it('lädt nur bekannte Sprachressourcen und nutzt sonst den Fallback', async function () {
        await import('@/language/useTranslationStore.ts')

        const german = await backendMock.loader?.('de')
        const fallback = await backendMock.loader?.('fr')

        expect(german).toBeDefined()
        expect(fallback).toBeDefined()
    })
})
