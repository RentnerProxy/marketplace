import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    applyAppThemeSettings,
    resetAppThemeSettings,
} from '@/lib/Theme/appTheme.ts'

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

        expect(rootStyle.getPropertyValue('--color-foreground')).toBe('#0f172a')
        expect(rootStyle.getPropertyValue('--color-secondary-text')).toBe(
            '#475569',
        )
        expect(rootStyle.getPropertyValue('--color-focus-ring')).toBe('#1d4ed8')
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
        expect(rootStyle.getPropertyValue('--color-success')).toBe('#047857')
        expect(rootStyle.getPropertyValue('--color-warning')).toBe('#854d0e')
        expect(rootStyle.getPropertyValue('--color-danger')).toBe('#b91c1c')
        expect(rootStyle.getPropertyValue('--rentner-foreground')).toBe(
            '#0f172a',
        )
        expect(rootStyle.getPropertyValue('--rentner-accent-foreground')).toBe(
            '#000000',
        )
        expect(rootStyle.getPropertyValue('--rentner-surface')).toBe(
            rootStyle.getPropertyValue('--color-surface-dark'),
        )
        expect(rootStyle.getPropertyValue('--rentner-danger')).toBe('#b91c1c')
        expect(rootStyle.getPropertyValue('--rentner-info')).toBe('#1d4ed8')
        expect(rootStyle.getPropertyValue('--rentner-control-hover')).toBe(
            '#f1f5f9',
        )
        expect(rootStyle.getPropertyValue('--color-white')).toBe('')
        expect(rootStyle.colorScheme).toBe('light')
    })

    it('restores the default dark theme', function () {
        applyAppThemeSettings({
            fontFamily: 'system',
            fontSize: 18,
            primaryColor: '#0891b2',
            primaryColorHover: '#00799a',
            themeMode: 'light',
        })

        resetAppThemeSettings()

        expect(rootStyle.getPropertyValue('--color-foreground')).toBe('#ffffff')
        expect(rootStyle.getPropertyValue('--color-secondary-text')).toBe(
            '#9ca3af',
        )
        expect(rootStyle.getPropertyValue('--color-focus-ring')).toBe('#65f586')
        expect(rootStyle.getPropertyValue('--rentner-foreground')).toBe(
            '#ffffff',
        )
        expect(rootStyle.getPropertyValue('--rentner-accent')).toBe(
            rootStyle.getPropertyValue('--color-primary'),
        )
        expect(rootStyle.getPropertyValue('--rentner-accent-hover')).toBe(
            rootStyle.getPropertyValue('--color-primary-hover'),
        )
        expect(rootStyle.getPropertyValue('--rentner-accent-foreground')).toBe(
            rootStyle.getPropertyValue('--color-primary-foreground'),
        )
        expect(rootStyle.getPropertyValue('--rentner-control-hover')).toBe(
            '#2e323b',
        )
        expect(rootStyle.colorScheme).toBe('dark')
        expect(themeClasses).not.toContain('app-theme-light')
        expect(themeClasses).toContain('app-theme-dark')
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
