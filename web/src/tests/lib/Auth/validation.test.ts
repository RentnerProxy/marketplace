import { describe, expect, it } from 'bun:test'
import {
    authCredentialPasswordSchema,
    authNewPasswordSchema,
} from '@/lib/Auth/validation.ts'
import { registrationInputSchema } from '@/features/Auth/Register/validation.ts'

describe('Passwort-Policy', function () {
    it('akzeptiert bestehende kurze Passwörter zur Credential-Prüfung', function () {
        expect(authCredentialPasswordSchema.safeParse('1').success).toBe(true)
        expect(authCredentialPasswordSchema.safeParse('').success).toBe(false)
    })

    it('accepts four-character new passwords without composition requirements', function () {
        for (const password of ['aaaa', '1234']) {
            expect(authNewPasswordSchema.safeParse(password).success).toBe(true)
            expect(
                registrationInputSchema.safeParse({
                    username: 'alice',
                    email: 'alice@example.test',
                    password,
                    acceptTerms: true,
                }).success,
            ).toBe(true)
        }
    })

    it.each(['', '1', '12', '123'])(
        'rejects new passwords and registration passwords below four characters: %s',
        function (password) {
            expect(authNewPasswordSchema.safeParse(password).success).toBe(
                false,
            )
            expect(
                registrationInputSchema.safeParse({
                    username: 'alice',
                    email: 'alice@example.test',
                    password,
                    acceptTerms: true,
                }).success,
            ).toBe(false)
        },
    )

    it('begrenzt Credential- und neue Passwörter auf 1024 Zeichen', function () {
        const maximumLengthPassword = 'a'.repeat(1_024)
        const oversizedPassword = 'a'.repeat(1_025)

        expect(
            authCredentialPasswordSchema.safeParse(maximumLengthPassword)
                .success,
        ).toBe(true)
        expect(
            authNewPasswordSchema.safeParse(maximumLengthPassword).success,
        ).toBe(true)
        expect(
            authCredentialPasswordSchema.safeParse(oversizedPassword).success,
        ).toBe(false)
        expect(authNewPasswordSchema.safeParse(oversizedPassword).success).toBe(
            false,
        )
    })
})
