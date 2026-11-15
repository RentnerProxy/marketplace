import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import MainTheme from '@/features/UserSettings/Components/AppearanceSection/Components/MainTheme.tsx'
import FontsSection from '@/features/UserSettings/Components/AppearanceSection/Components/FontsSection.tsx'
import FontSizeSection from '@/features/UserSettings/Components/AppearanceSection/Components/FontSizeSection.tsx'
import LanguageSection from '@/features/UserSettings/Components/AppearanceSection/Components/LanguageSection.tsx'
import type useMainThemeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useMainThemeLogic.ts'
import type useFontsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontsLogic.ts'
import type useFontSizeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontSizeLogic.ts'
import type useLanguageSettingsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useLanguageSettingsLogic.ts'
import {
    USER_FONT_FAMILIES,
    USER_FONT_FAMILY_STYLES,
    USER_FONT_SIZES,
} from '@/config/user-theme-colors.config.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let theme: ReturnType<typeof useMainThemeLogic>
let fonts: ReturnType<typeof useFontsLogic>
let size: ReturnType<typeof useFontSizeLogic>
let language: ReturnType<typeof useLanguageSettingsLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useMainThemeLogic.ts',
    () => ({ default: () => theme }),
)
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontsLogic.ts',
    () => ({ default: () => fonts }),
)
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontSizeLogic.ts',
    () => ({ default: () => size }),
)
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useLanguageSettingsLogic.ts',
    () => ({ default: () => language }),
)

beforeEach(() => {
    theme = {
        state: {
            themeMode: 'dark',
            selectedThemeMode: 'dark',
            isSavingThemeMode: false,
        },
        handler: { handleThemeModeChange: mock(), handleSaveThemeMode: mock() },
    }
    fonts = {
        state: {
            selectedFontFamily: USER_FONT_FAMILIES[0],
            isSavingFontFamily: false,
        },
        handler: {
            handleFontFamilyChange: mock(),
            handleSaveFontFamily: mock(),
        },
    }
    size = {
        state: {
            selectedFontSize: 16,
            selectedFontFamily: USER_FONT_FAMILIES[0],
            isSavingFontSize: false,
        },
        handler: { handleFontSizeChange: mock(), handleSaveFontSize: mock() },
    }
    language = {
        state: {
            availableLanguages: ['de', 'en'],
            selectedLanguage: 'de',
            hasLanguageChanged: true,
            isSavingLanguage: false,
        },
        handler: { handleSaveLanguage: mock(async () => {}) },
        setter: { setSelectedLanguage: mock() },
    }
})

describe('Appearance choices', () => {
    it('renders dark and light options with the selected theme highlighted and forwards choices', () => {
        const tree = MainTheme()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('userSettings.theme.dark')
        expect(html).toContain('userSettings.theme.light')
        const options = elements(tree).filter(
            (element) => element.type === 'button',
        )
        expect(options).toHaveLength(2)
        expect(options[0]!.props.className).toContain('shadow-')
        for (const option of options) invoke(option, 'onClick')
        expect(theme.handler.handleThemeModeChange).toHaveBeenCalledWith('dark')
        expect(theme.handler.handleThemeModeChange).toHaveBeenCalledWith(
            'light',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === theme.handler.handleSaveThemeMode,
            ),
            'onClick',
        )
        expect(theme.handler.handleSaveThemeMode).toHaveBeenCalledTimes(1)
        theme.state.isSavingThemeMode = true
        expect(renderToStaticMarkup(MainTheme())).toContain('common.saving')
        expect(
            findElement(
                MainTheme(),
                (element) =>
                    element.props.onClick === theme.handler.handleSaveThemeMode,
            ).props.disabled,
        ).toBe(true)
    })

    it('renders font choices in their own font and previews the chosen family', () => {
        const tree = FontsSection()
        const options = elements(tree).filter(
            (element) => element.type === 'button',
        )
        expect(options).toHaveLength(USER_FONT_FAMILIES.length)
        for (const [index, option] of options.entries()) {
            expect(option.props.style).toEqual({
                fontFamily: USER_FONT_FAMILY_STYLES[USER_FONT_FAMILIES[index]!],
            })
            invoke(option, 'onClick')
            expect(fonts.handler.handleFontFamilyChange).toHaveBeenCalledWith(
                USER_FONT_FAMILIES[index],
            )
        }
        expect(renderToStaticMarkup(tree)).toContain(
            'userSettings.font.previewText',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    fonts.handler.handleSaveFontFamily,
            ),
            'onClick',
        )
        expect(fonts.handler.handleSaveFontFamily).toHaveBeenCalledTimes(1)
        fonts.state.isSavingFontFamily = true
        expect(renderToStaticMarkup(FontsSection())).toContain('common.saving')
        expect(
            findElement(
                FontsSection(),
                (element) =>
                    element.props.onClick ===
                    fonts.handler.handleSaveFontFamily,
            ).props.disabled,
        ).toBe(true)
    })

    it('bounds the font size slider and converts slider values to numbers', () => {
        const tree = FontSizeSection()
        const slider = findElement(
            tree,
            (element) => element.props.type === 'range',
        )
        expect(slider.props).toMatchObject({
            min: USER_FONT_SIZES[0],
            max: USER_FONT_SIZES.at(-1),
            step: 1,
            value: 16,
        })
        invoke(slider, 'onChange', { target: { value: '18' } })
        expect(size.handler.handleFontSizeChange).toHaveBeenCalledWith(18)
        expect(renderToStaticMarkup(tree)).toContain('font-size:16px')
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === size.handler.handleSaveFontSize,
            ),
            'onClick',
        )
        expect(size.handler.handleSaveFontSize).toHaveBeenCalledTimes(1)
        size.state.isSavingFontSize = true
        expect(renderToStaticMarkup(FontSizeSection())).toContain(
            'common.saving',
        )
        expect(
            findElement(
                FontSizeSection(),
                (element) =>
                    element.props.onClick === size.handler.handleSaveFontSize,
            ).props.disabled,
        ).toBe(true)
    })

    it('marks the selected language accessibly and forwards selection and save', () => {
        const tree = LanguageSection()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('aria-pressed="true"')
        expect(html).toContain('aria-pressed="false"')
        expect(html).toContain('language.de')
        expect(html).toContain('language.en')
        invoke(
            findElement(
                tree,
                (element) => element.props['aria-pressed'] === false,
            ),
            'onClick',
        )
        expect(language.setter.setSelectedLanguage).toHaveBeenCalledWith('en')
        invoke(
            findElement(tree, (element) => element.props.isSaving === false),
            'onClick',
        )
        expect(language.handler.handleSaveLanguage).toHaveBeenCalledTimes(1)
        language.state.hasLanguageChanged = false
        expect(
            findElement(
                LanguageSection(),
                (element) => element.props.isSaving === false,
            ).props.disabled,
        ).toBe(true)
        language.state.isSavingLanguage = true
        expect(renderToStaticMarkup(LanguageSection())).toContain(
            'common.saving',
        )
    })
})
