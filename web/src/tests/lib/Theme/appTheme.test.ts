import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    applyAppThemeSettings,
    resetAppThemeSettings,
} from '@/lib/Theme/appTheme.ts'
import { getPrimaryThemeColors } from '@/lib/Theme/primaryColor.ts'

describe('applyAppThemeSettings', function () {
    const properties = new Map<string, string>()
    const themeClasses = new Set<string>()
    const rootClassList = {
        toggle: function (className: string, force?: boolean) {
            if (force) {
                themeClasses.add(className)
                return true
            }

            themeClasses.delete(className)
            return false
        },
    } as DOMTokenList
    const rootStyle = {
        colorScheme: '',
        fontSize: '',
        getPropertyValue: function (property: string) {
            return properties.get(property) ?? ''
        },
        setProperty: function (property: string, value: string) {
            properties.set(property, value)
        },
        removeProperty: function (property: string) {
            const value = properties.get(property) ?? ''
            properties.delete(property)
            return value
        },
    } as unknown as CSSStyleDeclaration

    beforeEach(function () {
        properties.clear()
        themeClasses.clear()
        rootStyle.colorScheme = ''
        rootStyle.fontSize = ''
        stubTestGlobal('document', {
            documentElement: {
                classList: rootClassList,
                style: rootStyle,
            },
        })
    })

    afterEach(function () {
        resetAppThemeSettings()
        restoreTestGlobals()
    })

    it('applies readable semantic colors for the light theme', function () {
        applyAppThemeSettings({
            fontFamily: 'inter',
            fontSize: 16,
            primaryColor: '#d97706',
            primaryColorHover: '#c15f00',
            themeMode: 'light',
        })

        expect(rootStyle.getPropertyValue('--color-foreground')).toBe('#06120f')
        const tinted = getPrimaryThemeColors('light', '#d97706')
        expect(rootStyle.getPropertyValue('--color-secondary-text')).toBe(
            tinted.secondaryText,
        )
        expect(tinted.secondaryText).not.toBe('#52675d')
        expect(rootStyle.getPropertyValue('--color-background-dark')).toBe(
            tinted.background,
        )
        expect(rootStyle.getPropertyValue('--color-proxy-400')).toBe('#d97706')
        expect(rootStyle.getPropertyValue('--color-mist-200')).not.toBe(
            '#dde9e3',
        )
        expect(rootStyle.getPropertyValue('--color-focus-ring')).toBe('#06120f')
        expect(rootStyle.getPropertyValue('--color-primary-foreground')).toBe(
            '#000000',
        )
        expect(
            rootStyle.getPropertyValue('--color-primary-hover-foreground'),
        ).toBe('#000000')
        expect(themeClasses).toContain('app-theme-light')
        expect(themeClasses).not.toContain('app-theme-dark')
        expect(rootStyle.getPropertyValue('--color-primary-text')).not.toBe(
            '#d97706',
        )
        expect(rootStyle.getPropertyValue('--color-success')).toBe('#0d6d2b')
        expect(rootStyle.getPropertyValue('--color-warning')).toBe('#854d0e')
        expect(rootStyle.getPropertyValue('--color-danger')).toBe('#b91c1c')
        expect(rootStyle.getPropertyValue('--rentner-foreground')).toBe(
            '#06120f',
        )
        expect(rootStyle.getPropertyValue('--rentner-accent-foreground')).toBe(
            '#000000',
        )
        expect(rootStyle.getPropertyValue('--rentner-surface')).toBe(
            rootStyle.getPropertyValue('--color-surface-dark'),
        )
        expect(rootStyle.getPropertyValue('--rentner-danger')).toBe('#b91c1c')
        expect(rootStyle.getPropertyValue('--rentner-info')).toBe('#06120f')
        expect(rootStyle.getPropertyValue('--rentner-control-hover')).toBe(
            tinted.background,
        )
        expect(rootStyle.getPropertyValue('--color-white')).toBe('')
        expect(rootStyle.colorScheme).toBe('light')
    })

    it('returns the document to the public stylesheet on reset', function () {
        applyAppThemeSettings({
            fontFamily: 'system',
            fontSize: 18,
            primaryColor: '#0891b2',
            primaryColorHover: '#00799a',
            themeMode: 'dark',
        })

        resetAppThemeSettings()

        expect(properties.size).toBe(0)
        expect(rootStyle.getPropertyValue('--color-foreground')).toBe('')
        expect(rootStyle.getPropertyValue('--rentner-accent')).toBe('')
        expect(rootStyle.getPropertyValue('--font-sans')).toBe('')
        expect(rootStyle.colorScheme).toBe('')
        expect(rootStyle.fontSize).toBe('')
        expect(themeClasses).not.toContain('app-theme-light')
        expect(themeClasses).not.toContain('app-theme-dark')
    })

    it('keeps custom primary buttons readable in the dark theme', function () {
        applyAppThemeSettings({
            fontFamily: 'inter',
            fontSize: 16,
            primaryColor: '#d97706',
            primaryColorHover: '#c15f00',
            themeMode: 'dark',
        })

        expect(rootStyle.getPropertyValue('--color-primary-foreground')).toBe(
            '#000000',
        )
        expect(
            rootStyle.getPropertyValue('--color-primary-hover-foreground'),
        ).toBe('#000000')
        expect(themeClasses).toContain('app-theme-dark')
    })
})
