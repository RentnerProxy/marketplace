import {
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_PRIMARY_COLOR_HOVER,
} from '@/config/user-theme-colors.config.ts'

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
