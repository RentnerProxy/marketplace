import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_PRIMARY_COLOR_HOVER,
    DEFAULT_THEME_MODE,
    USER_FONT_FAMILY_STYLES,
} from '@/config/user-theme-colors.config.ts'
import type { AppThemeSettings } from './Types/userTheme.types.ts'

import {
    getPrimaryColorForeground,
    getPrimaryTextColor,
    getPrimaryThemeColors,
    getPrimaryThemePalette,
} from './primaryColor.ts'

const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_FONT_SIZE,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    primaryColorHover: DEFAULT_PRIMARY_COLOR_HOVER,
    themeMode: DEFAULT_THEME_MODE,
}

function getAppThemeProperties(
    settings: AppThemeSettings,
): Record<string, string> {
    const themeColors = getPrimaryThemeColors(
        settings.themeMode,
        settings.primaryColor,
    )
    const primaryForeground = getPrimaryColorForeground(settings.primaryColor)

    return {
        '--color-primary': settings.primaryColor,
        '--color-primary-foreground': primaryForeground,
        '--color-primary-hover-foreground': primaryForeground,
        '--color-primary-text': getPrimaryTextColor(
            settings.primaryColor,
            themeColors.surface,
        ),
        '--color-primary-hover': settings.primaryColorHover,
        '--color-background-dark': themeColors.background,
        '--color-border-dark': themeColors.border,
        '--color-danger': themeColors.danger,
        '--color-focus-ring': themeColors.focusRing,
        '--color-foreground': themeColors.foreground,
        '--color-input-dark': themeColors.input,
        '--color-secondary-text': themeColors.secondaryText,
        '--color-success': themeColors.success,
        '--color-surface-dark': themeColors.surface,
        '--color-warning': themeColors.warning,
        '--rentner-control': themeColors.input,
        '--rentner-control-hover':
            settings.themeMode === 'light'
                ? themeColors.background
                : themeColors.border,
        '--rentner-surface': themeColors.surface,
        '--rentner-foreground': themeColors.foreground,
        '--rentner-muted': themeColors.secondaryText,
        '--rentner-border': themeColors.border,
        '--rentner-accent': settings.primaryColor,
        '--rentner-accent-hover': settings.primaryColorHover,
        '--rentner-accent-foreground': primaryForeground,
        '--rentner-danger': themeColors.danger,
        '--rentner-success': themeColors.success,
        '--rentner-warning': themeColors.warning,
        '--rentner-info': themeColors.focusRing,
        '--font-sans': USER_FONT_FAMILY_STYLES[settings.fontFamily],
        ...getPrimaryThemePalette(settings.primaryColor),
    }
}

export function applyAppThemeSettings(settings: AppThemeSettings) {
    const rootElement = document.documentElement
    const rootStyle = rootElement.style

    rootElement.classList.toggle(
        'app-theme-light',
        settings.themeMode === 'light',
    )
    rootElement.classList.toggle(
        'app-theme-dark',
        settings.themeMode === 'dark',
    )

    for (const [property, value] of Object.entries(
        getAppThemeProperties(settings),
    )) {
        rootStyle.setProperty(property, value)
    }

    rootStyle.colorScheme = settings.themeMode
    rootStyle.fontSize = `${settings.fontSize}px`
}

/**
 * Returns the document to the public stylesheet once the signed-in shell
 * unmounts, so public pages never inherit a signed-in theme.
 */
export function resetAppThemeSettings() {
    const rootElement = document.documentElement
    const rootStyle = rootElement.style

    rootElement.classList.toggle('app-theme-light', false)
    rootElement.classList.toggle('app-theme-dark', false)

    for (const property of Object.keys(
        getAppThemeProperties(DEFAULT_APP_THEME_SETTINGS),
    )) {
        rootStyle.removeProperty(property)
    }

    rootStyle.colorScheme = ''
    rootStyle.fontSize = ''
}
