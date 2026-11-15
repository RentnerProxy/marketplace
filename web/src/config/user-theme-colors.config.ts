export const DEFAULT_PRIMARY_COLOR = '#30ee61'
export const DEFAULT_PRIMARY_COLOR_HOVER = '#65f586'
export const DEFAULT_BACKGROUND_DARKNESS = 55
export const DEFAULT_THEME_MODE = 'dark'
export const DEFAULT_FONT_FAMILY = 'inter'
export const DEFAULT_FONT_SIZE = 16

export const USER_THEME_MODES = [
    'dark',
    'light',
] as const satisfies ReadonlyArray<UserThemeMode>
export const USER_FONT_FAMILIES = [
    'inter',
    'system',
    'serif',
    'mono',
] as const satisfies ReadonlyArray<UserFontFamily>
export const USER_FONT_SIZES = [
    14, 15, 16, 17, 18,
] as const satisfies ReadonlyArray<UserFontSize>

export const USER_THEME_MODE_COLORS: Record<UserThemeMode, UserThemeColors> = {
    dark: {
        background: '#0f1014',
        border: '#2e323b',
        danger: '#fca5a5',
        focusRing: '#65f586',
        foreground: '#ffffff',
        input: '#22252b',
        secondaryText: '#9ca3af',
        success: '#a7f3d0',
        surface: '#181a1f',
        warning: '#fde68a',
    },
    light: {
        background: '#f1f5f9',
        border: '#7c8da3',
        danger: '#b91c1c',
        focusRing: '#1d4ed8',
        foreground: '#0f172a',
        input: '#ffffff',
        secondaryText: '#475569',
        success: '#047857',
        surface: '#ffffff',
        warning: '#854d0e',
    },
}

export const USER_FONT_FAMILY_STYLES: Record<UserFontFamily, string> = {
    inter: "'Inter', ui-sans-serif, system-ui",
    system: 'ui-sans-serif, system-ui, Arial, sans-serif',
    serif: 'Georgia, Cambria, serif',
    mono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
}

export const USER_PRIMARY_COLOR_PRESETS = [
    DEFAULT_PRIMARY_COLOR,
    '#0891b2',
    '#059669',
    '#7c3aed',
    '#db2777',
    '#dc2626',
    '#d97706',
] as const
import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
    UserThemeColors,
} from '@/lib/Theme/Types/userTheme.types.ts'
