import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import AccountSection from '@/features/Auth/FirstSuperUser/Components/AccountSection.tsx'
import PersonalInfoSection from '@/features/Auth/FirstSuperUser/Components/PersonalInfoSection.tsx'
import type { FirstSuperUserFormValues } from '@/features/Auth/FirstSuperUser/Types/first-super-user-form.types.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const values: FirstSuperUserFormValues = {
    username: 'admin',
    email: 'admin@example.test',
    password: 'Example-password-123',
    confirmPassword: 'Example-password-123',
    firstName: 'Kevin',
    lastName: 'Test',
    street: 'Teststraße',
    houseNumber: '12',
    postalCode: '10115',
    city: 'Berlin',
}

describe('First administrator form sections', () => {
    it('routes all account edits to their field and associates password policy guidance', () => {
        const onFieldChange = mock()
        const tree = AccountSection({ values, onFieldChange })
        const fields = elements(tree).filter(
            (element) => typeof element.props.onValueChange === 'function',
        )
        expect(fields).toHaveLength(4)
        for (const [index, key] of [
            'username',
            'email',
            'password',
            'confirmPassword',
        ].entries()) {
            invoke(fields[index]!, 'onValueChange', 'changed')
            expect(onFieldChange).toHaveBeenCalledWith(key, 'changed')
        }
        expect(fields[2]!.props['aria-describedby']).toBe(
            'first-setup-password-policy',
        )
        expect(fields[3]!.props.required).toBe(true)
        expect(renderToStaticMarkup(tree)).toContain(
            'id="first-setup-password-policy"',
        )
    })

    it('forwards personal names and the address editor without losing existing values', () => {
        const onFieldChange = mock()
        const tree = PersonalInfoSection({ values, onFieldChange })
        const firstName = findElement(
            tree,
            (element) =>
                element.props.placeholder ===
                'userSettings.personalInfo.firstName',
        )
        invoke(firstName, 'onChange', { target: { value: 'Ada' } })
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.placeholder ===
                    'userSettings.personalInfo.lastName',
            ),
            'onChange',
            { target: { value: 'Lovelace' } },
        )
        expect(onFieldChange).toHaveBeenCalledWith('firstName', 'Ada')
        expect(onFieldChange).toHaveBeenCalledWith('lastName', 'Lovelace')
        const address = findElement(
            tree,
            (element) => element.props.values !== undefined,
        )
        expect(address.props.values).toBe(values)
        invoke(address, 'onChange', 'city', 'Bonn')
        expect(onFieldChange).toHaveBeenCalledWith('city', 'Bonn')
    })
})
