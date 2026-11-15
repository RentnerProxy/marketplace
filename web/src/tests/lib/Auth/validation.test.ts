import { describe, expect, it } from 'bun:test'
import {
    authCredentialPasswordSchema,
    authNewPasswordSchema,
} from '@/lib/Auth/validation.ts'

describe('Passwort-Policy', function () {
    it('akzeptiert bestehende kurze Passwörter zur Credential-Prüfung', function () {
        expect(authCredentialPasswordSchema.safeParse('1').success).toBe(true)
        expect(authCredentialPasswordSchema.safeParse('').success).toBe(false)
    })

    it('akzeptiert ab drei Zeichen ohne weitere Zusammensetzungsregeln', function () {
        expect(authNewPasswordSchema.safeParse('aaa').success).toBe(true)
        expect(authNewPasswordSchema.safeParse('123').success).toBe(true)
    })

    it.each(['', '1', '12'])(
        'lehnt neue Passwörter unter drei Zeichen ab: %s',
        function (password) {
            expect(authNewPasswordSchema.safeParse(password).success).toBe(
                false,
            )
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
