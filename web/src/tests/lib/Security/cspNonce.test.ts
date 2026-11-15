import { describe, expect, it } from 'bun:test'
import { parseDocumentCspNonce } from '@/lib/Security/cspNonce.ts'

const nonce = Buffer.alloc(32, 7).toString('base64url')

describe('CSP nonce metadata before browser hydration', () => {
    it('accepts exactly one canonical nonce without changing it', () => {
        expect(parseDocumentCspNonce([nonce])).toBe(nonce)
    })

    it.each(
        [
            [],
            [null],
            [undefined],
            [42],
            [{}],
            [''],
            [nonce, nonce],
            [nonce, ''],
            [nonce + '='],
            [nonce + '\n'],
            [nonce + '\r'],
            [nonce + '\r\n'],
            [' ' + nonce],
            [nonce + ' '],
            [nonce.slice(0, -1)],
            [nonce.slice(0, -1) + 'B'],
            [nonce + "'; script-src *"],
        ].map((values) => ({ values })),
    )('rejects missing, duplicated or malformed metadata', ({ values }) => {
        expect(() => parseDocumentCspNonce(values)).toThrow(
            'Die CSP-Kennung des Dokuments fehlt oder ist ungültig.',
        )
    })
})
