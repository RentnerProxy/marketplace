import { describe, expect, it } from 'bun:test'
import { updatePasswordByTokenInputSchema } from '@/features/Auth/PasswordReset/validation.ts'

describe('Passwort-Reset-Validierung', function () {
    it('akzeptiert ein neues Passwort mit vier Zeichen', function () {
        const result = updatePasswordByTokenInputSchema.safeParse({
            token: 'valid-reset-token',
            password: 'aaaa',
        })

        expect(result.success).toBe(true)
    })

    it.each(['', '1', '12', '123'])(
        'lehnt neue Passwörter unter vier Zeichen ab: %s',
        function (password) {
            const result = updatePasswordByTokenInputSchema.safeParse({
                token: 'valid-reset-token',
                password,
            })

            expect(result.success).toBe(false)
        },
    )
})
