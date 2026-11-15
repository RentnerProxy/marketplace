import { describe, expect, it } from 'bun:test'
import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'

describe('password-reset fragment links', function () {
    it.each([
        'https://example.test',
        'https://example.test:8443',
        'http://localhost:3000',
    ])(
        'preserves the configured origin %s and generated UUID',
        function (origin) {
            const token = '00000000-0000-4000-8000-000000000001'
            expect(createPasswordResetLinkService(origin, token)).toBe(
                origin + '/password-reset#token=' + token,
            )
        },
    )

    it.each([
        'legacy/&next=https://other.example.test/',
        '?token=another#nested',
        'already%2Fencoded+space value',
        'quotes\'"<>',
        'Grüße 😀\r\n\u0000',
    ])('encodes %j once into a single fragment token', function (token) {
        const link = createPasswordResetLinkService(
            'https://example.test',
            token,
        )
        const url = new URL(link)
        expect(url.origin).toBe('https://example.test')
        expect(url.pathname).toBe('/password-reset')
        expect(url.search).toBe('')
        expect(url.hash).toBe('#token=' + encodeURIComponent(token))
        expect([...new URLSearchParams(url.hash.slice(1))]).toEqual([
            ['token', token],
        ])
        expect(link.split('#')).toHaveLength(2)
    })
})
