import { describe, expect, it } from 'bun:test'
import { loginInputSchema } from '@/features/Auth/Login/validation.ts'

const credentials = { username: 'fixture-user', password: 'fixture-password' }

describe('loginInputSchema', function () {
    it('akzeptiert gültige Login-Daten', function () {
        const result = loginInputSchema.safeParse({
            ...credentials,
            twoFactorCode: '012345',
            trustThisDevice: true,
        })

        expect(result.success).toBe(true)
    })

    it('lehnt ungültige Zwei-Faktor-Codes ab', function () {
        const result = loginInputSchema.safeParse({
            ...credentials,
            twoFactorCode: 'abcdef',
        })

        expect(result.success).toBe(false)
    })

    it('trimmt den Benutzernamen vor der Prüfung', function () {
        const result = loginInputSchema.safeParse({
            ...credentials,
            username: `  ${credentials.username}  `,
        })

        expect(result.success).toBe(true)

        if (!result.success) {
            return
        }

        expect(result.data.username).toBe(credentials.username)
    })

    it('lehnt leere Benutzernamen nach dem Trimmen ab', function () {
        const result = loginInputSchema.safeParse({
            ...credentials,
            username: '   ',
        })

        expect(result.success).toBe(false)
    })

    it('akzeptiert Passwörter ohne Mindestlänge', function () {
        const result = loginInputSchema.safeParse({
            username: credentials.username,
            password: '1',
        })

        expect(result.success).toBe(true)
    })
})
