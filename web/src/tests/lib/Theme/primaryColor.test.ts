import { describe, expect, it } from 'bun:test'
import {
    BRAND_THEME_PALETTE,
    USER_THEME_MODE_COLORS,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_PRIMARY_COLOR_HOVER,
    USER_PRIMARY_COLOR_PRESETS,
} from '@/config/user-theme-colors.config.ts'
import {
    getPrimaryThemeColors,
    getPrimaryThemePalette,
    getPrimaryColorForeground,
    getPrimaryColorHover,
    getPrimaryTextColor,
} from '@/lib/Theme/primaryColor.ts'

function getTestRelativeLuminance(color: string) {
    const channels = [1, 3, 5].map(function (startIndex) {
        const value =
            Number.parseInt(color.slice(startIndex, startIndex + 2), 16) / 255

        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function getTestContrastRatio(firstColor: string, secondColor: string) {
    const firstLuminance = getTestRelativeLuminance(firstColor)
    const secondLuminance = getTestRelativeLuminance(secondColor)

    return (
        (Math.max(firstLuminance, secondLuminance) + 0.05) /
        (Math.min(firstLuminance, secondLuminance) + 0.05)
    )
}

describe('getPrimaryColorHover', function () {
    it('darkens a valid primary color', function () {
        expect(DEFAULT_PRIMARY_COLOR).toBe('#30ee61')
        expect(DEFAULT_PRIMARY_COLOR_HOVER).toBe('#65f586')
        expect(getPrimaryColorHover(DEFAULT_PRIMARY_COLOR)).toBe(
            DEFAULT_PRIMARY_COLOR_HOVER,
        )
    })

    it('accepts a valid primary color without a hash', function () {
        expect(getPrimaryColorHover('2563eb')).toBe('#0d4bd3')
    })

    it('clamps dark color channels at zero', function () {
        expect(getPrimaryColorHover('#101820')).toBe('#000008')
    })

    it.each(['#fff', '#gggggg'])(
        'uses the configured fallback for invalid color %s',
        function (color) {
            expect(getPrimaryColorHover(color)).toBe(
                DEFAULT_PRIMARY_COLOR_HOVER,
            )
        },
    )
})

describe('getPrimaryColorForeground', function () {
    it('uses white on a dark primary color', function () {
        expect(getPrimaryColorForeground('#2563eb')).toBe('#ffffff')
    })

    it('uses dark text on a bright primary color', function () {
        expect(getPrimaryColorForeground('#d97706')).toBe('#000000')
    })

    it('accepts colors without a hash', function () {
        expect(getPrimaryColorForeground('d97706')).toBe('#000000')
    })

    it.each([...USER_PRIMARY_COLOR_PRESETS, '#7b7b7b'])(
        'provides sufficient contrast on primary color %s',
        function (primaryColor) {
            expect(
                getTestContrastRatio(
                    primaryColor,
                    getPrimaryColorForeground(primaryColor),
                ),
            ).toBeGreaterThanOrEqual(4.5)
        },
    )

    it.each([...USER_PRIMARY_COLOR_PRESETS])(
        'keeps the primary foreground readable throughout hover for %s',
        function (primaryColor) {
            const primaryColorHover = getPrimaryColorHover(primaryColor)
            const primaryForeground = getPrimaryColorForeground(primaryColor)

            expect(
                getTestContrastRatio(primaryColorHover, primaryForeground),
            ).toBeGreaterThanOrEqual(4.5)
        },
    )

    it('uses white for invalid colors', function () {
        expect(getPrimaryColorForeground('#fff')).toBe('#ffffff')
    })
})

describe('getPrimaryTextColor', function () {
    it('keeps a primary color that already has enough contrast', function () {
        expect(getPrimaryTextColor('#1d4ed8', '#ffffff')).toBe('#1d4ed8')
    })

    it('darkens a bright primary color on a light surface', function () {
        expect(getPrimaryTextColor('#d97706', '#ffffff')).toMatch(
            /^#[0-9a-f]{6}$/,
        )
        expect(getPrimaryTextColor('#d97706', '#ffffff')).not.toBe('#d97706')
    })

    it.each([...USER_PRIMARY_COLOR_PRESETS])(
        'provides extra contrast for primary text color %s',
        function (primaryColor) {
            const primaryTextColor = getPrimaryTextColor(
                primaryColor,
                '#ffffff',
            )

            expect(
                getTestContrastRatio(primaryTextColor, '#ffffff'),
            ).toBeGreaterThanOrEqual(5.25)
        },
    )

    it('lightens a dark primary color on a dark surface', function () {
        expect(getPrimaryTextColor('#101820', '#181a1f')).not.toBe('#101820')
    })

    it('uses the configured fallback for invalid colors', function () {
        expect(getPrimaryTextColor('#fff', '#ffffff')).toBe(
            DEFAULT_PRIMARY_COLOR_HOVER,
        )
    })
})

describe('getPrimaryThemePalette', function () {
    it('keeps the exact landing palette for the default system color', function () {
        expect(getPrimaryThemePalette(DEFAULT_PRIMARY_COLOR)).toEqual(
            BRAND_THEME_PALETTE,
        )
        expect(getPrimaryThemePalette('not-a-color')).toEqual(
            BRAND_THEME_PALETTE,
        )
    })

    it('derives accents, foreground and neutral grays from a custom color', function () {
        const palette = getPrimaryThemePalette('#0891B2')
        expect(palette['--color-proxy-400']).toBe('#0891b2')
        expect(palette['--color-proxy-50']).toBe('#e6f4f7')
        expect(palette['--color-proxy-900']).toBe('#033a47')
        expect(palette['--color-on-proxy']).toBe(
            getPrimaryColorForeground('#0891b2'),
        )
        const brandPalette: Record<string, string> = BRAND_THEME_PALETTE
        for (const neutral of [
            '--color-night',
            '--color-steel-700',
            '--color-mist-200',
        ]) {
            expect(palette[neutral]).not.toBe(brandPalette[neutral])
        }
        expect(Object.keys(palette).toSorted()).toEqual(
            Object.keys(BRAND_THEME_PALETTE).toSorted(),
        )
    })
})

describe('getPrimaryThemeColors', function () {
    it('returns the configured theme colors for the default system color', function () {
        for (const mode of ['dark', 'light'] as const) {
            expect(getPrimaryThemeColors(mode, DEFAULT_PRIMARY_COLOR)).toBe(
                USER_THEME_MODE_COLORS[mode],
            )
        }
    })

    it.each(
        USER_PRIMARY_COLOR_PRESETS.filter(
            (color) => color !== DEFAULT_PRIMARY_COLOR,
        ),
    )(
        'tints neutrals for %s while keeping text readable',
        function (primaryColor) {
            for (const mode of ['dark', 'light'] as const) {
                const colors = getPrimaryThemeColors(mode, primaryColor)
                const base = USER_THEME_MODE_COLORS[mode]
                expect(colors.background).not.toBe(base.background)
                expect(colors.secondaryText).not.toBe(base.secondaryText)
                expect(colors.success).toBe(base.success)
                expect(colors.danger).toBe(base.danger)
                expect(
                    getTestContrastRatio(
                        colors.secondaryText,
                        colors.background,
                    ),
                ).toBeGreaterThanOrEqual(4.5)
                expect(
                    getTestContrastRatio(colors.secondaryText, colors.surface),
                ).toBeGreaterThanOrEqual(4.5)
            }
        },
    )
})
