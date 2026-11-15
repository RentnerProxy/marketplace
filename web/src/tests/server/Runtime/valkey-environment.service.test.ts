import { z } from 'zod'
import { parseValkeyUrl } from '@/server/Valkey/valkeyUrl.ts'
import { describe, expect, it } from 'bun:test'
import { resolveValkeyUrlEnvironment } from '@/server/Runtime/valkey-environment.service.ts'

describe('Valkey-Environment', function () {
    it('lässt eine Valkey-URL ohne separates Passwort unverändert', function () {
        const environment = {
            VALKEY_URL: 'redis://:synthetic-runtime-password@localhost:6380/0',
        }

        expect(resolveValkeyUrlEnvironment(environment)).toEqual(environment)
    })

    it('kodiert ein separates Passwort sicher in die Valkey-URL', function () {
        expect(
            resolveValkeyUrlEnvironment({
                VALKEY_PASSWORD: 'p@ss:/?#% word',
                VALKEY_URL: 'redis://valkey:6379/2',
            }),
        ).toMatchObject({
            VALKEY_URL: 'redis://:p%40ss%3A%2F%3F%23%25%20word@valkey:6379/2',
        })
    })

    it('überschreibt Zugangsdaten aus der URL mit dem separaten Passwort', function () {
        expect(
            resolveValkeyUrlEnvironment({
                VALKEY_PASSWORD: 'new-secret',
                VALKEY_URL:
                    'rediss://user:old-secret@valkey.example.com:6380/1',
            }),
        ).toMatchObject({
            VALKEY_URL: 'rediss://user:new-secret@valkey.example.com:6380/1',
        })
    })

    it('lehnt leere und kontrollzeichenhaltige Passwörter ab', function () {
        expect(() =>
            resolveValkeyUrlEnvironment({
                VALKEY_PASSWORD: '   ',
                VALKEY_URL: 'redis://valkey:6379',
            }),
        ).toThrow(/Leerzeichen/)
        expect(() =>
            resolveValkeyUrlEnvironment({
                VALKEY_PASSWORD: 'line\nbreak',
                VALKEY_URL: 'redis://valkey:6379',
            }),
        ).toThrow(/Steuerzeichen/)
    })
})

function resolveSyntheticConnection(environment: unknown) {
    const resolved = z
        .object({ VALKEY_URL: z.string() })
        .parse(resolveValkeyUrlEnvironment(environment))
    return parseValkeyUrl(resolved.VALKEY_URL)
}

describe('effective Valkey authentication', function () {
    it.each([
        'redis://:synthetic-password@localhost:6379/0',
        'rediss://synthetic-user:synthetic-password@localhost:6380/4',
        'redis://synthetic-user:synthetic-password@[::1]:6379/2',
    ])(
        'keeps an authenticated URL and its input object unchanged',
        function (url) {
            const environment = { VALKEY_URL: url }
            expect(resolveValkeyUrlEnvironment(environment)).toBe(environment)
            expect(environment.VALKEY_URL).toBe(url)
        },
    )

    it.each([undefined, ''])(
        'accepts embedded credentials when a separate override is absent or empty',
        function (password) {
            const environment = {
                VALKEY_URL:
                    'rediss://synthetic-user:embedded-password@localhost:6380/4',
                VALKEY_PASSWORD: password,
            }

            expect(resolveValkeyUrlEnvironment(environment)).toBe(environment)
            expect(resolveSyntheticConnection(environment)).toEqual({
                username: 'synthetic-user',
                password: 'embedded-password',
                host: 'localhost',
                port: 6380,
                database: 4,
                tls: true,
            })
        },
    )

    it.each([
        undefined,
        '',
        'redis://localhost:6379/0',
        'redis://synthetic-user@localhost:6379/0',
        'rediss://synthetic-user:@localhost:6380/4',
        'redis://:@localhost:6379/0',
        'redis://synthetic-user:%20%20@localhost:6379/0',
    ])('rejects a missing or empty effective password', function (url) {
        expect(() => resolveValkeyUrlEnvironment({ VALKEY_URL: url })).toThrow()
    })

    it.each([
        undefined,
        '',
        'redis://localhost:6379/0',
        'rediss://synthetic-user:@localhost:6380/4',
    ])(
        'does not let an empty override enable an anonymous URL',
        function (url) {
            expect(() =>
                resolveValkeyUrlEnvironment({
                    VALKEY_URL: url,
                    VALKEY_PASSWORD: '',
                }),
            ).toThrow()
        },
    )

    it.each([
        'synthetic @:/?#%+ password',
        'synthetic-ä-漢字-🔐',
        'synthetic%2F%25%40',
        ' synthetic boundary spaces ',
    ])(
        'encodes a raw override exactly once and preserves all URL components',
        function (password) {
            const environment = {
                VALKEY_URL:
                    'rediss://synthetic%40acl:old-password@[::1]:6380/4',
                VALKEY_PASSWORD: password,
            }
            const resolved = z
                .object({ VALKEY_URL: z.string() })
                .parse(resolveValkeyUrlEnvironment(environment))
            const parsed = parseValkeyUrl(resolved.VALKEY_URL)

            expect(parsed).toEqual({
                username: 'synthetic@acl',
                password,
                host: '::1',
                port: 6380,
                database: 4,
                tls: true,
            })
            expect(new URL(resolved.VALKEY_URL).password).toBe(
                encodeURIComponent(password),
            )
            expect(environment.VALKEY_URL).toBe(
                'rediss://synthetic%40acl:old-password@[::1]:6380/4',
            )
            expect(environment.VALKEY_PASSWORD).toBe(password)
            expect(
                resolveValkeyUrlEnvironment({
                    VALKEY_URL: resolved.VALKEY_URL,
                    VALKEY_PASSWORD: password,
                }),
            ).toEqual({
                VALKEY_URL: resolved.VALKEY_URL,
                VALKEY_PASSWORD: password,
            })
        },
    )

    it.each([
        'synthetic @:/?#%+ password',
        'synthetic-ä-漢字-🔐',
        'synthetic%2F%25%40',
        ' synthetic boundary spaces ',
    ])(
        'decodes an embedded password exactly once without rewriting the URL',
        function (password) {
            const environment = {
                VALKEY_URL:
                    'rediss://synthetic%40acl:' +
                    encodeURIComponent(password) +
                    '@localhost:6380/4',
            }

            expect(resolveValkeyUrlEnvironment(environment)).toBe(environment)
            expect(resolveSyntheticConnection(environment)).toEqual({
                username: 'synthetic@acl',
                password,
                host: 'localhost',
                port: 6380,
                database: 4,
                tls: true,
            })
        },
    )

    it('authenticates an anonymous base URL using the separate override', function () {
        expect(
            resolveSyntheticConnection({
                VALKEY_URL: 'redis://localhost:6379/2',
                VALKEY_PASSWORD: 'synthetic-password',
            }),
        ).toEqual({
            username: undefined,
            password: 'synthetic-password',
            host: 'localhost',
            port: 6379,
            database: 2,
            tls: false,
        })
    })

    it.each([
        ' ',
        'synthetic\npassword',
        'synthetic\u0000password',
        'x'.repeat(4097),
    ])(
        'rejects invalid separate passwords even when embedded credentials are valid',
        function (password) {
            expect(() =>
                resolveValkeyUrlEnvironment({
                    VALKEY_URL:
                        'redis://synthetic-user:embedded-password@localhost:6379/0',
                    VALKEY_PASSWORD: password,
                }),
            ).toThrow()
        },
    )

    it.each([
        ' ',
        'synthetic\npassword',
        'synthetic\u0000password',
        'x'.repeat(4097),
    ])(
        'applies the existing password policy to embedded credentials',
        function (password) {
            expect(() =>
                resolveValkeyUrlEnvironment({
                    VALKEY_URL:
                        'redis://synthetic-user:' +
                        encodeURIComponent(password) +
                        '@localhost:6379/0',
                }),
            ).toThrow()
        },
    )

    it.each([
        'redis://synthetic-user:%@localhost:6379/0',
        'redis://synthetic-user:%C0%AF@localhost:6379/0',
        'https://synthetic-user:synthetic-password@localhost:6379/0',
        'redis://synthetic-user:synthetic-password@localhost:6379/0?unexpected=1',
        'redis://synthetic-user:synthetic-password@localhost:6379/0#unexpected',
        'redis://synthetic-user:synthetic-password@localhost:6379/-1',
        'redis://synthetic-user:synthetic-password@localhost:65536/0',
    ])('retains the existing URL and credential validation', function (url) {
        expect(() => resolveValkeyUrlEnvironment({ VALKEY_URL: url })).toThrow()
    })
})
