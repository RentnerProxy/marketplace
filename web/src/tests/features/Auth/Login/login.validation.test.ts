import { faker } from '@faker-js/faker'
import { describe, expect, it } from 'bun:test'
import { loginInputSchema } from '@/features/Auth/Login/validation.ts'

describe('loginInputSchema', function () {
    it('akzeptiert gültige Login-Daten', function () {
        const result = loginInputSchema.safeParse({
            username: faker.internet.username().slice(0, 50),
            password: faker.internet.password({ length: 16 }),
            twoFactorCode: faker.string.numeric(6),
            trustThisDevice: faker.datatype.boolean(),
        })

        expect(result.success).toBe(true)
    })

    it('lehnt ungültige Zwei-Faktor-Codes ab', function () {
        const result = loginInputSchema.safeParse({
            username: faker.internet.username(),
            password: faker.internet.password({ length: 16 }),
            twoFactorCode: faker.string.alpha(6),
        })

        expect(result.success).toBe(false)
    })

    it('trimmt den Benutzernamen vor der Prüfung', function () {
        const result = loginInputSchema.safeParse({
            username: `  ${faker.internet.username().slice(0, 46)}  `,
            password: faker.internet.password({ length: 16 }),
        })

        expect(result.success).toBe(true)

        if (!result.success) {
            return
        }

        expect(result.data.username).toBe(result.data.username.trim())
    })

    it('lehnt leere Benutzernamen nach dem Trimmen ab', function () {
        const result = loginInputSchema.safeParse({
            username: '   ',
            password: faker.internet.password({ length: 16 }),
        })

        expect(result.success).toBe(false)
    })

    it('akzeptiert Passwörter ohne Mindestlänge', function () {
        const result = loginInputSchema.safeParse({
            username: faker.internet.username(),
            password: '1',
        })

        expect(result.success).toBe(true)
    })
})
