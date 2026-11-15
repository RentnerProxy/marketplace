import { beforeEach, expect, it, vi } from 'bun:test'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
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
const { default: useFooter } =
    await import('@/layouts/PublicLayout/Hooks/useFooterLogic.ts')
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    setLanguage.mockResolvedValue(undefined)
})

it('uses default branding and skips selecting the already active language', async () => {
    const result = renderHook(useFooter)
    expect(result.state.currentYear).toBe(new Date().getFullYear())
    expect(result.state.companyName.length).toBeGreaterThan(0)
    await result.handler.handleLanguageChange('de')
    expect(setLanguage).not.toHaveBeenCalled()
})

it('disables language changes while one is pending and resets pending state on failure', async () => {
    const deferred = Promise.withResolvers<void>()
    setLanguage.mockReturnValueOnce(deferred.promise)
    const operation = renderHook(useFooter).handler.handleLanguageChange('en')
    expect(renderHook(useFooter).state.isChangingLanguage).toBe(true)
    expect(renderHook(useFooter).state.companyName).toBe(
        PROJECT_CONFIG.defaultName,
    )
    await renderHook(useFooter).handler.handleLanguageChange('en')
    expect(setLanguage).toHaveBeenCalledTimes(1)
    deferred.resolve()
    await operation
    expect(renderHook(useFooter).state.isChangingLanguage).toBe(false)
    const error = new Error('offline')
    setLanguage.mockRejectedValueOnce(error)
    await expect(
        renderHook(useFooter).handler.handleLanguageChange('en'),
    ).resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledWith(error)
    expect(renderHook(useFooter).state.isChangingLanguage).toBe(false)
})
