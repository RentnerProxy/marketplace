import { describe, expect, it } from 'bun:test'
import { isPasswordResetTokenValidationValid } from '@/lib/Auth/PasswordReset/passwordResetTokenValidation.ts'

describe('Passwort-Reset-Token-Kompatibilität', function () {
    it('verwendet den aktuellen valid-Vertrag vorrangig', function () {
        expect(
            isPasswordResetTokenValidationValid({ valid: true, length: 0 }),
        ).toBe(true)
        expect(
            isPasswordResetTokenValidationValid({ valid: false, length: 1 }),
        ).toBe(false)
    })

    it('unterstützt die frühere Array-Antwort während des Rollouts', function () {
        expect(isPasswordResetTokenValidationValid([{}])).toBe(true)
        expect(isPasswordResetTokenValidationValid([])).toBe(false)
    })

    it('weist unbekannte Antwortformen sicher zurück', function () {
        expect(isPasswordResetTokenValidationValid(null)).toBe(false)
        expect(isPasswordResetTokenValidationValid({ length: '1' })).toBe(false)
    })
})
