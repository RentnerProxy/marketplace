import { describe, expect, it } from 'bun:test'
import { createTokenHash, createTokenHashSync } from '@/lib/Auth/tokens.ts'

describe('token SHA-256 compatibility', function () {
    it('returns the existing digest in lower-case hexadecimal', async function () {
        const expected =
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        expect(createTokenHashSync('abc')).toBe(expected)
        await expect(createTokenHash('abc')).resolves.toBe(expected)
    })

    it.each(['', 'Grüße 日本語 😀', 'e\u0301\u0000', '\ud800', '\udc00'])(
        'preserves the legacy UTF-8 digest for %j',
        async function (value) {
            const bytes = new TextEncoder().encode(value)
            const legacy = await crypto.subtle.digest('SHA-256', bytes)
            expect(createTokenHashSync(value)).toBe(
                Buffer.from(legacy).toString('hex'),
            )
        },
    )
})
