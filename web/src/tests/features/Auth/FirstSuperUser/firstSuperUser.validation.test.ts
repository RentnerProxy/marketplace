import { describe, expect, it } from 'bun:test'
import {
    createFirstSuperUserAccountFormSchema,
    createFirstSuperUserAccountInputSchema,
} from '@/features/Auth/FirstSuperUser/validation.ts'

const validInput = {
    username: 'admin',
    email: 'admin@example.com',
    password: 'secure-password',
    confirmPassword: 'secure-password',
    firstName: '',
    lastName: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
}

describe('First-Superuser-Validierung', function () {
    it('akzeptiert vollständige gültige Accountdaten', function () {
        expect(
            createFirstSuperUserAccountInputSchema.safeParse(validInput)
                .success,
        ).toBe(true)
    })

    it('lehnt voneinander abweichende Passwörter ab', function () {
        const result = createFirstSuperUserAccountInputSchema.safeParse({
            ...validInput,
            confirmPassword: 'different-password',
        })

        expect(result.success).toBe(false)
    })

    it('akzeptiert ein Passwort mit vier Zeichen', function () {
        const result = createFirstSuperUserAccountInputSchema.safeParse({
            ...validInput,
            password: 'aaaa',
            confirmPassword: 'aaaa',
        })

        expect(result.success).toBe(true)
    })

    it.each(['', '1', '12', '123'])(
        'lehnt neue Passwörter unter vier Zeichen ab: %s',
        function (password) {
            const result = createFirstSuperUserAccountInputSchema.safeParse({
                ...validInput,
                password,
                confirmPassword: password,
            })

            expect(result.success).toBe(false)
        },
    )
})

describe('separate first setup form and server contracts', function () {
    it('excludes setup access from parsed form state', function () {
        const parsed = createFirstSuperUserAccountFormSchema.parse({
            ...validInput,
            setupToken: 'synthetic-not-a-form-field',
        })
        expect('setupToken' in parsed).toBe(false)
        expect(Object.keys(parsed)).toHaveLength(10)
    })

    it('preserves the existing server token default, trim and bound', function () {
        expect(
            createFirstSuperUserAccountInputSchema.parse(validInput).setupToken,
        ).toBe('')
        expect(
            createFirstSuperUserAccountInputSchema.parse({
                ...validInput,
                setupToken: ' synthetic-token ',
            }).setupToken,
        ).toBe('synthetic-token')
        expect(
            createFirstSuperUserAccountInputSchema.safeParse({
                ...validInput,
                setupToken: 'A'.repeat(256),
            }).success,
        ).toBe(false)
    })
})
