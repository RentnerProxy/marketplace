import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    client,
    createSession,
    failure,
    query,
    render,
    reset,
    setLanguage,
    settle,
    success,
    translation,
} from './settings-hooks.test.helpers.ts'
import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
} from '@/lib/Theme/Types/userTheme.types.ts'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'

type PreferenceResult<T> =
    ({ success: true } & T) | { success: false; error: string }
const fontFamily = vi.fn(
    async ({
        data,
    }: {
        data: { fontFamily: UserFontFamily }
    }): Promise<PreferenceResult<{ fontFamily: UserFontFamily }>> => ({
        success: true,
        fontFamily: data.fontFamily,
    }),
)
const fontSize = vi.fn(
    async ({
        data,
    }: {
        data: { fontSize: UserFontSize }
    }): Promise<PreferenceResult<{ fontSize: UserFontSize }>> => ({
        success: true,
        fontSize: data.fontSize,
    }),
)
const themeMode = vi.fn(
    async (_input: {
        data: { themeMode: UserThemeMode }
    }): Promise<PreferenceResult<{ themeMode?: UserThemeMode }>> => ({
        success: true,
    }),
)

vi.mock('@rentnerkev/toasts', () => ({
    toast: { success, error: failure },
}))
vi.mock('@/language/languageStore.ts', () => ({
    translateCurrentLanguage(
        key: 'language.savedDescription' | 'language.savedTitle',
    ) {
        const messages = translation.language === 'en' ? en : de
        return key === 'language.savedTitle'
            ? messages.language.savedTitle
            : messages.language.savedDescription
    },
}))
vi.mock('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserFontFamilyHandler: fontFamily,
    updateCurrentUserFontSizeHandler: fontSize,
    updateCurrentUserThemeModeHandler: themeMode,
}))

import useFontsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontsLogic.ts'
import useFontSizeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontSizeLogic.ts'
import useMainThemeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useMainThemeLogic.ts'
import useLanguageSettingsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useLanguageSettingsLogic.ts'

beforeEach(function () {
    reset()
    fontFamily.mockReset().mockImplementation(async ({ data }) => ({
        success: true,
        fontFamily: data.fontFamily,
    }))
    fontSize.mockReset().mockImplementation(async ({ data }) => ({
        success: true,
        fontSize: data.fontSize,
    }))
    themeMode.mockReset().mockResolvedValue({ success: true })
    client.setQueryData(['session'], createSession())
    query.mockReturnValue({ data: createSession() })
})

describe('appearance preference actions', function () {
    it('saves a selected font while preserving the rest of the cached session', async function () {
        render(useFontsLogic).handler.handleFontFamilyChange('mono')
        render(useFontsLogic).handler.handleSaveFontFamily()
        expect(render(useFontsLogic).state.isSavingFontFamily).toBe(true)
        await settle()
        expect(fontFamily).toHaveBeenCalledWith({
            data: { fontFamily: 'mono' },
        })
        expect(client.getQueryData(['session'])).toMatchObject({
            permissions: ['user.profile'],
            user: { id: 'member-1', fontFamily: 'mono', fontSize: 16 },
        })
        expect(success).toHaveBeenCalledWith('toast.fontFamilySaved', {
            title: 'userSettings.header.title',
        })
        expect(render(useFontsLogic).state.isSavingFontFamily).toBe(false)
    })

    it('resynchronizes font drafts when the session changes and rejects invalid stored preferences', function () {
        expect(render(useFontsLogic).state.selectedFontFamily).toBe('inter')
        render(useFontsLogic).handler.handleFontFamilyChange('mono')
        query.mockReturnValue({ data: { user: { fontFamily: 'serif' } } })
        render(useFontsLogic)
        expect(render(useFontsLogic).state.selectedFontFamily).toBe('serif')
        query.mockReturnValue({
            data: { user: { fontFamily: 'invalid-font' } },
        })
        render(useFontsLogic)
        expect(render(useFontsLogic).state.selectedFontFamily).toBe('inter')
    })

    it('reports a failed font transport without changing cached preferences', async function () {
        const transportError = new Error('Synthetic font failure')
        fontFamily.mockRejectedValueOnce(transportError)
        render(useFontsLogic).handler.handleSaveFontFamily()
        await settle()
        expect(failure).toHaveBeenCalledWith(transportError)
        expect(success).not.toHaveBeenCalled()
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { fontFamily: 'inter' },
        })
    })

    it('keeps the cached font when the server rejects a preference change', async function () {
        fontFamily.mockResolvedValueOnce({
            success: false,
            error: 'Font unavailable',
        })
        render(useFontsLogic).handler.handleSaveFontFamily()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Font unavailable' }),
        )
        expect(success).not.toHaveBeenCalled()
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { fontFamily: 'inter' },
        })
    })

    it('accepts supported font sizes and ignores invalid input before saving', async function () {
        expect(render(useFontSizeLogic).state.selectedFontFamily).toBe('inter')
        render(useFontSizeLogic).handler.handleFontSizeChange(18)
        render(useFontSizeLogic).handler.handleFontSizeChange(999)
        expect(render(useFontSizeLogic).state.selectedFontSize).toBe(18)
        render(useFontSizeLogic).handler.handleSaveFontSize()
        await settle()
        expect(fontSize).toHaveBeenCalledWith({ data: { fontSize: 18 } })
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { fontSize: 18, fontFamily: 'inter' },
        })
        expect(success).toHaveBeenCalledWith('toast.fontSizeSaved', {
            title: 'userSettings.header.title',
        })
    })

    it('resynchronizes changed font sizes and falls back from invalid session settings', function () {
        render(useFontSizeLogic)
        query.mockReturnValue({
            data: { user: { fontSize: 14, fontFamily: 'serif' } },
        })
        render(useFontSizeLogic)
        expect(render(useFontSizeLogic).state).toMatchObject({
            selectedFontSize: 14,
            selectedFontFamily: 'serif',
        })
        query.mockReturnValue({
            data: { user: { fontSize: 100, fontFamily: 'unknown' } },
        })
        render(useFontSizeLogic)
        expect(render(useFontSizeLogic).state).toMatchObject({
            selectedFontSize: 16,
            selectedFontFamily: 'inter',
        })
    })

    it('reports size transport failures without a success notification', async function () {
        const error = new Error('Synthetic size failure')
        fontSize.mockRejectedValueOnce(error)
        render(useFontSizeLogic).handler.handleSaveFontSize()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
        expect(success).not.toHaveBeenCalled()
    })

    it('keeps the cached size when the server rejects a preference change', async function () {
        fontSize.mockResolvedValueOnce({
            success: false,
            error: 'Size unavailable',
        })
        render(useFontSizeLogic).handler.handleSaveFontSize()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Size unavailable' }),
        )
        expect(success).not.toHaveBeenCalled()
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { fontSize: 16 },
        })
    })

    it('saves theme selection and revalidates the authenticated session', async function () {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        render(useMainThemeLogic).handler.handleThemeModeChange('light')
        render(useMainThemeLogic).handler.handleSaveThemeMode()
        expect(render(useMainThemeLogic).state.isSavingThemeMode).toBe(true)
        await settle()
        expect(themeMode).toHaveBeenCalledWith({ data: { themeMode: 'light' } })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session'] })
        expect(success).toHaveBeenCalledTimes(1)
        expect(render(useMainThemeLogic).state.isSavingThemeMode).toBe(false)
        invalidate.mockRestore()
    })

    it('leaves the existing theme write in flight when another control tries to save', function () {
        const isMutating = vi.spyOn(client, 'isMutating').mockReturnValue(1)
        try {
            render(useMainThemeLogic).handler.handleSaveThemeMode()
            expect(isMutating).toHaveBeenCalledWith({
                mutationKey: ['current-user-theme-mode'],
                exact: true,
            })
            expect(themeMode).not.toHaveBeenCalled()
        } finally {
            isMutating.mockRestore()
        }
    })

    it('adopts an external theme change and ignores an invalid stored mode', function () {
        render(useMainThemeLogic)
        query.mockReturnValue({ data: { user: { themeMode: 'light' } } })
        render(useMainThemeLogic)
        expect(render(useMainThemeLogic).state).toMatchObject({
            themeMode: 'light',
            selectedThemeMode: 'light',
        })
        query.mockReturnValue({ data: { user: { themeMode: 'invalid' } } })
        render(useMainThemeLogic)
        expect(render(useMainThemeLogic).state.selectedThemeMode).toBe('dark')
    })

    it('reports a rejected theme change without announcing success or refetching', async function () {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        themeMode.mockResolvedValueOnce({
            success: false,
            error: 'Theme unavailable',
        })
        render(useMainThemeLogic).handler.handleSaveThemeMode()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Theme unavailable' }),
        )
        expect(success).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
        invalidate.mockRestore()
    })

    it('reports a failed theme request without announcing success', async function () {
        const error = new Error('Theme transport unavailable')
        themeMode.mockRejectedValueOnce(error)
        render(useMainThemeLogic).handler.handleSaveThemeMode()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
        expect(success).not.toHaveBeenCalled()
    })
})

describe('language preference actions', function () {
    it('avoids unchanged saves, persists a new language and clears the pending state', async function () {
        await render(useLanguageSettingsLogic).handler.handleSaveLanguage()
        expect(setLanguage).not.toHaveBeenCalled()
        render(useLanguageSettingsLogic).setter.setSelectedLanguage('en')
        expect(render(useLanguageSettingsLogic).state.hasLanguageChanged).toBe(
            true,
        )
        setLanguage.mockImplementationOnce(async () => {
            translation.language = 'en'
        })
        await render(useLanguageSettingsLogic).handler.handleSaveLanguage()
        expect(setLanguage).toHaveBeenCalledWith('en')
        expect(success).toHaveBeenCalledWith(en.language.savedDescription, {
            title: en.language.savedTitle,
        })
        expect(render(useLanguageSettingsLogic).state.isSavingLanguage).toBe(
            false,
        )
    })

    it('prevents duplicate pending saves and resets after a rejected persistence operation', async function () {
        const deferred = Promise.withResolvers<void>()
        setLanguage.mockReturnValueOnce(deferred.promise)
        render(useLanguageSettingsLogic).setter.setSelectedLanguage('en')
        const saving = render(
            useLanguageSettingsLogic,
        ).handler.handleSaveLanguage()
        expect(render(useLanguageSettingsLogic).state.isSavingLanguage).toBe(
            true,
        )
        await render(useLanguageSettingsLogic).handler.handleSaveLanguage()
        expect(setLanguage).toHaveBeenCalledTimes(1)
        const error = new Error('Synthetic language failure')
        deferred.reject(error)
        await expect(saving).resolves.toBeUndefined()
        expect(failure).toHaveBeenCalledWith(error)
        expect(render(useLanguageSettingsLogic).state.isSavingLanguage).toBe(
            false,
        )
        expect(success).not.toHaveBeenCalled()
    })

    it('resets a stale language draft when the translation store changes', function () {
        render(useLanguageSettingsLogic)
        translation.language = 'en'
        render(useLanguageSettingsLogic)
        expect(render(useLanguageSettingsLogic).state).toMatchObject({
            selectedLanguage: 'en',
            hasLanguageChanged: false,
        })
    })
})
