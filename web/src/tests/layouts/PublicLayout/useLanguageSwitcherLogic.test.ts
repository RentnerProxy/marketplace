import { beforeEach, expect, it, vi } from 'bun:test'
import { hookReact, renderHook, resetHooks } from '../hook-harness.ts'

const setLanguage = vi.fn(async (_language: string) => {})
const reportError = vi.fn()
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: reportError,
}))
vi.mock('react', () => hookReact)
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        availableLanguages: ['de', 'en'],
        language: 'de',
        setLanguage,
    }),
}))
const { default: useSwitcher } =
    await import('@/layouts/PublicLayout/Hooks/useLanguageSwitcherLogic.ts')
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    setLanguage.mockResolvedValue(undefined)
})

it('provides native language options and skips selecting the already active language', async () => {
    const result = renderHook(useSwitcher)
    expect(result.state.options.map((option) => option.value)).toEqual(['de', 'en'])
    await result.handler.handleLanguageChange('de')
    expect(setLanguage).not.toHaveBeenCalled()
})

it('disables language changes while one is pending and resets pending state on failure', async () => {
    const deferred = Promise.withResolvers<void>()
    setLanguage.mockReturnValueOnce(deferred.promise)
    const operation = renderHook(useSwitcher).handler.handleLanguageChange('en')
    expect(renderHook(useSwitcher).state.isChangingLanguage).toBe(true)
    await renderHook(useSwitcher).handler.handleLanguageChange('en')
    expect(setLanguage).toHaveBeenCalledTimes(1)
    deferred.resolve()
    await operation
    expect(renderHook(useSwitcher).state.isChangingLanguage).toBe(false)
    const error = new Error('offline')
    setLanguage.mockRejectedValueOnce(error)
    await expect(
        renderHook(useSwitcher).handler.handleLanguageChange('en'),
    ).resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledWith(error)
    expect(renderHook(useSwitcher).state.isChangingLanguage).toBe(false)
})
