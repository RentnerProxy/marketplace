import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SystemColorSection from '@/features/UserSettings/Components/AppearanceSection/Components/SystemColorSection.tsx'
import type useSystemColorLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useSystemColorLogic.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: ReturnType<typeof useSystemColorLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'de', t: (key: string) => key }),
}))
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useSystemColorLogic.ts',
    () => ({ default: () => logic }),
)

beforeEach(() => {
    logic = {
        state: {
            colorPresets: ['#2563eb'],
            primaryColorResetKey: 0,
            selectedPrimaryColor: '#112233',
            selectedPrimaryColorForeground: '#ffffff',
            selectedPrimaryColorHover: '#223344',
            selectedPrimaryColorTransparent: '#11223322',
            isPrimaryColorValid: true,
            isSavingPrimaryColor: false,
        },
        handler: {
            handlePrimaryColorChange: mock(),
            handlePrimaryColorValidityChange: mock(),
            handleResetPrimaryColor: mock(),
            handleSavePrimaryColor: mock(),
        },
    }
})

describe('SystemColorSection', () => {
    it('renders chosen color, contrast and hover previews and forwards picker actions', () => {
        const tree = SystemColorSection()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('background-color:#112233')
        expect(html).toContain('color:#ffffff')
        expect(html).toContain('background-color:#223344')
        expect(html).toContain('userSettings.color.primaryButton')
        const picker = findElement(
            tree,
            (element) => element.props.id === 'primary-color',
        )
        expect(picker.props).toMatchObject({
            locale: 'de',
            value: '#112233',
            format: 'hex',
            disabled: false,
        })
        invoke(picker, 'onValueChange', '#aabbcc')
        invoke(picker, 'onValidityChange', false)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleResetPrimaryColor,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSavePrimaryColor,
            ),
            'onClick',
        )
        expect(logic.handler.handlePrimaryColorChange).toHaveBeenCalledWith(
            '#aabbcc',
        )
        expect(
            logic.handler.handlePrimaryColorValidityChange,
        ).toHaveBeenCalledWith(false)
        expect(logic.handler.handleResetPrimaryColor).toHaveBeenCalledTimes(1)
        expect(logic.handler.handleSavePrimaryColor).toHaveBeenCalledTimes(1)
    })

    it('prevents invalid saves and locks editing while a save is pending', () => {
        logic.state.isPrimaryColorValid = false
        expect(
            findElement(
                SystemColorSection(),
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSavePrimaryColor,
            ).props.disabled,
        ).toBe(true)
        logic.state.isSavingPrimaryColor = true
        const tree = SystemColorSection()
        expect(renderToStaticMarkup(tree)).toContain('common.saving')
        expect(
            findElement(tree, (element) => element.props.id === 'primary-color')
                .props.disabled,
        ).toBe(true)
        expect(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleResetPrimaryColor,
            ).props.disabled,
        ).toBe(true)
    })
})
