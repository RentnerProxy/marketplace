import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_PRIMARY_COLOR_HOVER,
    DEFAULT_THEME_MODE,
    USER_FONT_FAMILY_STYLES,
    USER_THEME_MODE_COLORS,
} from '@/config/user-theme-colors.config.ts'
import type { AppThemeSettings } from './Types/userTheme.types.ts'

import {
    getPrimaryColorForeground,
    getPrimaryTextColor,
} from './primaryColor.ts'

const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_FONT_SIZE,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    primaryColorHover: DEFAULT_PRIMARY_COLOR_HOVER,
    themeMode: DEFAULT_THEME_MODE,
}

export function applyAppThemeSettings(settings: AppThemeSettings) {
    const themeColors = USER_THEME_MODE_COLORS[settings.themeMode]
    const rootElement = document.documentElement
    const rootStyle = rootElement.style
    const primaryForeground = getPrimaryColorForeground(settings.primaryColor)

    rootElement.classList.toggle(
        'app-theme-light',
        settings.themeMode === 'light',
    )
    rootElement.classList.toggle(
        'app-theme-dark',
        settings.themeMode === 'dark',
    )

    rootStyle.setProperty('--color-primary', settings.primaryColor)
    rootStyle.setProperty('--color-primary-foreground', primaryForeground)
    rootStyle.setProperty('--color-primary-hover-foreground', primaryForeground)
    rootStyle.setProperty(
        '--color-primary-text',
        getPrimaryTextColor(settings.primaryColor, themeColors.surface),
    )
    rootStyle.setProperty('--color-primary-hover', settings.primaryColorHover)
    rootStyle.setProperty('--color-background-dark', themeColors.background)
    rootStyle.setProperty('--color-border-dark', themeColors.border)
    rootStyle.setProperty('--color-danger', themeColors.danger)
    rootStyle.setProperty('--color-focus-ring', themeColors.focusRing)
    rootStyle.setProperty('--color-foreground', themeColors.foreground)
    rootStyle.setProperty('--color-input-dark', themeColors.input)
    rootStyle.setProperty('--color-secondary-text', themeColors.secondaryText)
    rootStyle.setProperty('--color-success', themeColors.success)
    rootStyle.setProperty('--color-surface-dark', themeColors.surface)
    rootStyle.setProperty('--color-warning', themeColors.warning)

    rootStyle.setProperty('--rentner-control', themeColors.input)
    rootStyle.setProperty(
        '--rentner-control-hover',
        settings.themeMode === 'light'
            ? themeColors.background
            : themeColors.border,
    )
    rootStyle.setProperty('--rentner-surface', themeColors.surface)
    rootStyle.setProperty('--rentner-foreground', themeColors.foreground)
    rootStyle.setProperty('--rentner-muted', themeColors.secondaryText)
    rootStyle.setProperty('--rentner-border', themeColors.border)
    rootStyle.setProperty('--rentner-accent', settings.primaryColor)
    rootStyle.setProperty('--rentner-accent-hover', settings.primaryColorHover)
    rootStyle.setProperty('--rentner-accent-foreground', primaryForeground)
    rootStyle.setProperty('--rentner-danger', themeColors.danger)
    rootStyle.setProperty('--rentner-success', themeColors.success)
    rootStyle.setProperty('--rentner-warning', themeColors.warning)
    rootStyle.setProperty('--rentner-info', themeColors.focusRing)
    rootStyle.setProperty(
        '--font-sans',
        USER_FONT_FAMILY_STYLES[settings.fontFamily],
    )
    rootStyle.colorScheme = settings.themeMode
    rootStyle.fontSize = `${settings.fontSize}px`
}

export function resetAppThemeSettings() {
    applyAppThemeSettings(DEFAULT_APP_THEME_SETTINGS)
}
