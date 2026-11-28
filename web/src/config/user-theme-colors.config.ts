import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
    UserThemeColors,
} from '@/lib/Theme/Types/userTheme.types.ts'

export const DEFAULT_PRIMARY_COLOR = '#30ee61'
export const DEFAULT_PRIMARY_COLOR_HOVER = '#65f586'

/** Landing page palette; custom system colors derive their own values. */
export const BRAND_THEME_PALETTE = {
    '--color-proxy-50': '#e9fff0',
    '--color-proxy-100': '#d2ffdd',
    '--color-proxy-200': '#a3ffb8',
    '--color-proxy-300': '#65f586',
    '--color-proxy-400': '#30ee61',
    '--color-proxy-500': '#18d348',
    '--color-proxy-600': '#0fb33a',
    '--color-proxy-700': '#0d8a31',
    '--color-proxy-800': '#0d6d2b',
    '--color-proxy-900': '#0d5926',
    '--color-on-proxy': '#06120f',
    '--color-night': '#121a16',
    '--color-night-input': '#1b2620',
    '--color-night-muted': '#a3b8ad',
    '--color-steel-500': '#657a70',
    '--color-steel-600': '#52675d',
    '--color-steel-700': '#3d5148',
    '--color-mist-50': '#f7faf8',
    '--color-mist-100': '#eef4f1',
    '--color-mist-200': '#dde9e3',
    '--color-mist-300': '#c1d2c9',
    '--color-mist-400': '#91a99d',
    '--color-mist-500': '#6e867a',
} as const

/** Share of white (negative) or black (positive) mixed into a custom accent. */
export const ACCENT_PALETTE_STEPS = {
    '--color-proxy-50': -0.9,
    '--color-proxy-100': -0.8,
    '--color-proxy-200': -0.6,
    '--color-proxy-300': -0.3,
    '--color-proxy-400': 0,
    '--color-proxy-500': 0.12,
    '--color-proxy-600': 0.25,
    '--color-proxy-700': 0.4,
    '--color-proxy-800': 0.52,
    '--color-proxy-900': 0.6,
} as const

/** Neutral gray plus a share of the custom system color, so nothing stays green. */
export const NEUTRAL_TINT_STEPS = {
    '--color-night': ['#141414', 0.08],
    '--color-night-input': ['#1e1e1e', 0.08],
    '--color-night-muted': ['#ababab', 0.12],
    '--color-steel-500': ['#6e6e6e', 0.14],
    '--color-steel-600': ['#5a5a5a', 0.14],
    '--color-steel-700': ['#434343', 0.14],
    '--color-mist-50': ['#f9f9f9', 0.04],
    '--color-mist-100': ['#f1f1f1', 0.06],
    '--color-mist-200': ['#e3e3e3', 0.08],
    '--color-mist-300': ['#cacaca', 0.1],
    '--color-mist-400': ['#a0a0a0', 0.12],
    '--color-mist-500': ['#7d7d7d', 0.12],
} as const

export const USER_THEME_MODE_TINTS: Record<
    UserThemeMode,
    Partial<Record<keyof UserThemeColors, readonly [string, number]>>
> = {
    dark: {
        background: ['#030303', 0.04],
        surface: ['#0a0a0a', 0.06],
        input: ['#121212', 0.07],
        border: ['#2e2e2e', 0.18],
        secondaryText: ['#a6a6a6', 0.12],
    },
    light: {
        background: ['#ececec', 0.12],
        input: ['#f8f8f8', 0.04],
        secondaryText: ['#4d4d4d', 0.16],
    },
}

export const DEFAULT_BACKGROUND_DARKNESS = 55
export const DEFAULT_THEME_MODE = 'light'
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
        background: '#040807',
        border: '#2f4238',
        danger: '#fca5a5',
        focusRing: '#65f586',
        foreground: '#ffffff',
        input: '#101814',
        secondaryText: '#9bb0a5',
        success: '#a3ffb8',
        surface: '#0a110e',
        warning: '#fde68a',
    },
    light: {
        background: '#e2efe6',
        border: '#06120f',
        danger: '#b91c1c',
        focusRing: '#06120f',
        foreground: '#06120f',
        input: '#f7faf8',
        secondaryText: '#52675d',
        success: '#0d6d2b',
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
