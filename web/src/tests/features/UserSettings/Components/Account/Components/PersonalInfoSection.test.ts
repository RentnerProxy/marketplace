import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PersonalInfoSection from '@/features/UserSettings/Components/Account/Components/PersonalInfoSection.tsx'
import type usePersonalInfoSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/usePersonalInfoSettingsLogic.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

const logic: ReturnType<typeof usePersonalInfoSettingsLogic> = {
    state: {
        cityValue: 'Berlin',
        firstNameValue: 'Kevin',
        houseNumberValue: '12',
        isSavingPersonalInfo: false,
        lastNameValue: 'Test',
        postalCodeValue: '10115',
        streetValue: 'Teststraße',
    },
    handler: {
        handleCityChange: mock(),
        handleFirstNameChange: mock(),
        handleHouseNumberChange: mock(),
        handleLastNameChange: mock(),
        handlePostalCodeChange: mock(),
        handleSavePersonalInfo: mock(),
        handleStreetChange: mock(),
    },
}
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module(
    '@/features/UserSettings/Components/Account/Hooks/usePersonalInfoSettingsLogic.ts',
    () => ({ default: () => logic }),
)
const props = {
    city: '',
    firstName: '',
    houseNumber: '',
    lastName: '',
    postalCode: '',
    street: '',
}

describe('PersonalInfoSection', () => {
    it('renders personal details and routes each address/name update to its owner', () => {
        logic.state.isSavingPersonalInfo = false
        const tree = PersonalInfoSection(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('value="Kevin"')
        expect(html).toContain('value="Berlin"')
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.placeholder ===
                    'userSettings.personalInfo.firstName',
            ),
            'onChange',
            { target: { value: 'First' } },
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.placeholder ===
                    'userSettings.personalInfo.lastName',
            ),
            'onChange',
            { target: { value: 'Last' } },
        )
        expect(logic.handler.handleFirstNameChange).toHaveBeenCalledWith(
            'First',
        )
        expect(logic.handler.handleLastNameChange).toHaveBeenCalledWith('Last')
        const address = findElement(
            tree,
            (element) => element.props.values !== undefined,
        )
        for (const [key, handler] of [
            ['city', logic.handler.handleCityChange],
            ['street', logic.handler.handleStreetChange],
            ['houseNumber', logic.handler.handleHouseNumberChange],
            ['postalCode', logic.handler.handlePostalCodeChange],
        ] as const) {
            invoke(address, 'onChange', key, 'updated')
            expect(handler).toHaveBeenCalledWith('updated')
        }
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSavePersonalInfo,
            ),
            'onClick',
        )
        expect(logic.handler.handleSavePersonalInfo).toHaveBeenCalledTimes(1)
    })

    it('disables save and shows saving feedback during submission', () => {
        logic.state.isSavingPersonalInfo = true
        const tree = PersonalInfoSection(props)
        expect(renderToStaticMarkup(tree)).toContain('common.saving')
        expect(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSavePersonalInfo,
            ).props.disabled,
        ).toBe(true)
    })
})
