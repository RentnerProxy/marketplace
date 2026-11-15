import { describe, expect, it } from 'bun:test'
import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'

describe('hasControlCharacters', function () {
    it.each([...Array.from({ length: 32 }, (_, code) => code), 127])(
        'erkennt das Kontrollzeichen mit Codepunkt %i an jeder Position',
        function (codePoint) {
            const character = String.fromCodePoint(codePoint)

            expect(hasControlCharacters(character)).toBe(true)
            expect(hasControlCharacters(character + 'abc')).toBe(true)
            expect(hasControlCharacters('abc' + character)).toBe(true)
            expect(hasControlCharacters('😀' + character + 'x')).toBe(true)
        },
    )

    it.each([
        '',
        ' ',
        '~',
        String.fromCodePoint(128),
        String.fromCodePoint(159),
        'ä漢字😀',
        '\ud800',
        '\udfff',
        '/user/dashboard?search=hello%20world#section',
        '%00%1f%7f',
    ])(
        'verändert die Bedeutung anderer Zeichen nicht: Fall %#',
        function (value) {
            expect(hasControlCharacters(value)).toBe(false)
        },
    )
})
