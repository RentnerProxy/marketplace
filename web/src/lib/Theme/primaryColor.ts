import {
    ACCENT_PALETTE_STEPS,
    BRAND_THEME_PALETTE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_PRIMARY_COLOR_HOVER,
    NEUTRAL_TINT_STEPS,
    USER_THEME_MODE_COLORS,
    USER_THEME_MODE_TINTS,
} from '@/config/user-theme-colors.config.ts'
import type {
    UserThemeColors,
    UserThemeMode,
} from '@/lib/Theme/Types/userTheme.types.ts'

const LIGHT_PRIMARY_FOREGROUND = '#ffffff'
const DARK_PRIMARY_FOREGROUND = '#000000'
const MINIMUM_PRIMARY_FOREGROUND_CONTRAST = 4.5
const MINIMUM_PRIMARY_TEXT_CONTRAST = 5.25

function getRelativeLuminance(color: string) {
    const channels = [
        color.slice(1, 3),
        color.slice(3, 5),
        color.slice(5, 7),
    ].map(function (channel) {
        const value = Number.parseInt(channel, 16) / 255

        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function getContrastRatio(firstColor: string, secondColor: string) {
    const firstLuminance = getRelativeLuminance(firstColor)
    const secondLuminance = getRelativeLuminance(secondColor)
    const lighterLuminance = Math.max(firstLuminance, secondLuminance)
    const darkerLuminance = Math.min(firstLuminance, secondLuminance)

    return (lighterLuminance + 0.05) / (darkerLuminance + 0.05)
}

function mixColor(firstColor: string, secondColor: string, weight: number) {
    const channels = [1, 3, 5].map(function (startIndex) {
        const firstChannel = Number.parseInt(
            firstColor.slice(startIndex, startIndex + 2),
            16,
        )
        const secondChannel = Number.parseInt(
            secondColor.slice(startIndex, startIndex + 2),
            16,
        )

        return Math.round(
            firstChannel + (secondChannel - firstChannel) * weight,
        )
            .toString(16)
            .padStart(2, '0')
    })

    return `#${channels.join('')}`
}

export function getPrimaryColorHover(primaryColor: string) {
    const normalizedColor = primaryColor.replace('#', '')

    if (`#${normalizedColor.toLowerCase()}` === DEFAULT_PRIMARY_COLOR) {
        return DEFAULT_PRIMARY_COLOR_HOVER
    }

    if (normalizedColor.length !== 6) {
        return DEFAULT_PRIMARY_COLOR_HOVER
    }

    const colorNumber = Number.parseInt(normalizedColor, 16)

    if (Number.isNaN(colorNumber)) {
        return DEFAULT_PRIMARY_COLOR_HOVER
    }

    const red = Math.max(0, ((colorNumber >> 16) & 255) - 24)
    const green = Math.max(0, ((colorNumber >> 8) & 255) - 24)
    const blue = Math.max(0, (colorNumber & 255) - 24)

    const normalizedPrimaryColor = `#${normalizedColor.toLowerCase()}`
    const darkenedColor = `#${[red, green, blue]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')}`
    const primaryForeground = getPrimaryColorForeground(normalizedPrimaryColor)

    if (
        getContrastRatio(darkenedColor, primaryForeground) >=
        MINIMUM_PRIMARY_FOREGROUND_CONTRAST
    ) {
        return darkenedColor
    }

    for (let step = 1; step <= 100; step += 1) {
        const candidateColor = mixColor(
            darkenedColor,
            normalizedPrimaryColor,
            step / 100,
        )

        if (
            getContrastRatio(candidateColor, primaryForeground) >=
            MINIMUM_PRIMARY_FOREGROUND_CONTRAST
        ) {
            return candidateColor
        }
    }

    return normalizedPrimaryColor
}

export function getPrimaryColorForeground(primaryColor: string) {
    const normalizedColor = primaryColor.startsWith('#')
        ? primaryColor
        : `#${primaryColor}`

    if (!/^#[0-9a-fA-F]{6}$/.test(normalizedColor)) {
        return LIGHT_PRIMARY_FOREGROUND
    }

    const lightContrast = getContrastRatio(
        normalizedColor,
        LIGHT_PRIMARY_FOREGROUND,
    )
    const darkContrast = getContrastRatio(
        normalizedColor,
        DARK_PRIMARY_FOREGROUND,
    )

    return darkContrast > lightContrast
        ? DARK_PRIMARY_FOREGROUND
        : LIGHT_PRIMARY_FOREGROUND
}

export function getPrimaryTextColor(
    primaryColor: string,
    backgroundColor: string,
) {
    const normalizedPrimaryColor = primaryColor.startsWith('#')
        ? primaryColor
        : `#${primaryColor}`
    const normalizedBackgroundColor = backgroundColor.startsWith('#')
        ? backgroundColor
        : `#${backgroundColor}`

    if (
        !/^#[0-9a-fA-F]{6}$/.test(normalizedPrimaryColor) ||
        !/^#[0-9a-fA-F]{6}$/.test(normalizedBackgroundColor)
    ) {
        return DEFAULT_PRIMARY_COLOR_HOVER
    }

    if (
        getContrastRatio(normalizedPrimaryColor, normalizedBackgroundColor) >=
        MINIMUM_PRIMARY_TEXT_CONTRAST
    ) {
        return normalizedPrimaryColor.toLowerCase()
    }

    const targetColor =
        getRelativeLuminance(normalizedBackgroundColor) > 0.5
            ? '#000000'
            : '#ffffff'

    for (let step = 1; step <= 100; step += 1) {
        const candidateColor = mixColor(
            normalizedPrimaryColor,
            targetColor,
            step / 100,
        )

        if (
            getContrastRatio(candidateColor, normalizedBackgroundColor) >=
            MINIMUM_PRIMARY_TEXT_CONTRAST
        ) {
            return candidateColor
        }
    }

    return targetColor
}

const TINTABLE_THEME_TOKENS: Array<keyof UserThemeColors> = [
    'background',
    'border',
    'input',
    'secondaryText',
    'surface',
]

function getCustomPrimaryColor(primaryColor: string) {
    const normalizedColor = (
        primaryColor.startsWith('#') ? primaryColor : `#${primaryColor}`
    ).toLowerCase()

    return normalizedColor !== DEFAULT_PRIMARY_COLOR &&
        /^#[0-9a-f]{6}$/.test(normalizedColor)
        ? normalizedColor
        : null
}

/**
 * Palette for the comic UI. The default color keeps the exact landing
 * palette; any other system color gets tints and shades of itself for the
 * accents, a readable foreground for accent fills and neutral grays with a
 * hint of itself instead of the green-tinted landing neutrals.
 */
export function getPrimaryThemePalette(
    primaryColor: string,
): Record<string, string> {
    const customColor = getCustomPrimaryColor(primaryColor)

    if (!customColor) {
        return { ...BRAND_THEME_PALETTE }
    }

    const palette: Record<string, string> = {
        '--color-on-proxy': getPrimaryColorForeground(customColor),
    }

    for (const [property, step] of Object.entries(ACCENT_PALETTE_STEPS)) {
        palette[property] =
            step === 0
                ? customColor
                : mixColor(
                      customColor,
                      step < 0 ? '#ffffff' : '#000000',
                      Math.abs(step),
                  )
    }

    for (const [property, [neutral, share]] of Object.entries(
        NEUTRAL_TINT_STEPS,
    )) {
        palette[property] = mixColor(neutral, customColor, share)
    }

    return palette
}

/** Theme mode colors whose neutrals follow a custom system color. */
export function getPrimaryThemeColors(
    themeMode: UserThemeMode,
    primaryColor: string,
): UserThemeColors {
    const themeColors = USER_THEME_MODE_COLORS[themeMode]
    const customColor = getCustomPrimaryColor(primaryColor)

    if (!customColor) {
        return themeColors
    }

    const tints = USER_THEME_MODE_TINTS[themeMode]
    const tintedColors: UserThemeColors = { ...themeColors }

    for (const token of TINTABLE_THEME_TOKENS) {
        const tint = tints[token]

        if (tint) {
            tintedColors[token] = mixColor(tint[0], customColor, tint[1])
        }
    }

    if (themeMode === 'dark') {
        tintedColors.focusRing = mixColor(customColor, '#ffffff', 0.3)
    }

    return tintedColors
}
