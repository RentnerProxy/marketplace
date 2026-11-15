import { describe, expect, it } from 'bun:test'
import { getErrorMessage, normalizeError } from '@/lib/Errors/error.ts'

describe('Error-Helper', function () {
    it('behält bestehende Error-Instanzen unverändert', function () {
        const error = new Error('Bestehender Fehler')

        expect(normalizeError(error, 'Fallback')).toBe(error)
        expect(getErrorMessage(error, 'Fallback')).toBe('Bestehender Fehler')
    })

    it('normalisiert unbekannte Fehler mit Fallback und Ursache', function () {
        const cause = { reason: 'unknown' }
        const error = normalizeError(cause, 'Fallback')

        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Fallback')
        expect(error.cause).toBe(cause)
        expect(getErrorMessage(cause, 'Fallback')).toBe('Fallback')
    })

    it('behält die Standardmeldung für unbekannte und leere Fehler bei', function () {
        expect(getErrorMessage({ reason: 'unknown' })).toBe(
            'Ein unerwarteter Fehler ist aufgetreten.',
        )
        expect(normalizeError({ reason: 'unknown' }).message).toBe(
            'Ein unerwarteter Fehler ist aufgetreten.',
        )
        expect(getErrorMessage(new Error(''))).toBe(
            'Ein unerwarteter Fehler ist aufgetreten.',
        )
    })

    it('wirft unbekannte Werte als normalisierte Error-Instanz', function () {
        const cause = { reason: 'unknown' }

        expect(function () {
            throw normalizeError(cause, 'Fallback')
        }).toThrow(
            expect.objectContaining({
                cause,
                message: 'Fallback',
            }),
        )
    })
})
