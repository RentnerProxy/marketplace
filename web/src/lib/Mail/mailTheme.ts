import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_THEME_MODE,
    USER_FONT_FAMILY_STYLES,
    USER_THEME_MODE_COLORS,
} from '@/config/user-theme-colors.config.ts'
import {
    getPrimaryColorForeground,
    getPrimaryTextColor,
} from '@/lib/Theme/primaryColor.ts'
import {
    isUserFontFamily,
    isUserFontSize,
} from '@/lib/Theme/userFontSettings.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import type { MailTheme, MailThemeInput } from './Types/mail-template.types.ts'

export function createMailTheme(input: MailThemeInput = {}): MailTheme {
    const themeMode = isUserThemeMode(input.themeMode)
        ? input.themeMode
        : DEFAULT_THEME_MODE
    const colors = USER_THEME_MODE_COLORS[themeMode]
    const primaryColor =
        typeof input.primaryColor === 'string' &&
        input.primaryColor.length === 7 &&
        /^#[0-9a-f]{6}$/iu.test(input.primaryColor)
            ? input.primaryColor.toLowerCase()
            : DEFAULT_PRIMARY_COLOR
    const fontFamily = isUserFontFamily(input.fontFamily)
        ? input.fontFamily
        : DEFAULT_FONT_FAMILY

    return {
        colors,
        primaryColor,
        primaryForeground: getPrimaryColorForeground(primaryColor),
        primaryText: getPrimaryTextColor(primaryColor, colors.background),
        fontFamily:
            USER_FONT_FAMILY_STYLES[fontFamily] +
            (fontFamily === 'inter' ? ', Arial, sans-serif' : ''),
        fontSize: isUserFontSize(input.fontSize)
            ? input.fontSize
            : DEFAULT_FONT_SIZE,
        noticeBackground: themeMode === 'dark' ? '#25221a' : '#fffbeb',
    }
}
