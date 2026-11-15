import type { FirstSuperUserFormValues } from '@/features/Auth/FirstSuperUser/Types/first-super-user-form.types.ts'

export function createFirstSetupFormValues(): FirstSuperUserFormValues {
    return {
        username: 'fixture-user',
        email: 'fixture@example.test',
        password: 'abc',
        confirmPassword: 'abc',
        firstName: '',
        lastName: '',
        street: '',
        houseNumber: '',
        postalCode: '',
        city: '',
    }
}
