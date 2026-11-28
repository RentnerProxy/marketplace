import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import AccountSection from '@/features/Auth/FirstSuperUser/Components/AccountSection.tsx'
import type { FirstSuperUserFormValues } from '@/features/Auth/FirstSuperUser/Types/first-super-user-form.types.ts'
import {
    elements,
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
})
