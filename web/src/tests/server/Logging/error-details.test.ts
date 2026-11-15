import { SQL } from 'bun'
import { describe, expect, it, vi } from 'bun:test'
import {
    createSafeErrorForStorageService,
    getSafeErrorDetailsService,
} from '@/server/Logging/error-details.ts'

describe('sichere Fehlerdetails und Queue-Persistenz', () => {
    it('beschränkt tiefe Ursachen und Aggregate auf sichere Deskriptoren', () => {
        let cause: unknown = new Error('deep-secret')
        for (let i = 0; i < 12; i++)
            cause = new TypeError('secret-' + i, { cause })
        const error = new AggregateError(
            Array.from({ length: 12 }, () =>
                Object.assign(new Error('smtp-secret'), { code: 'ETIMEDOUT' }),
            ),
            'sql-secret',
            { cause },
        )
        const details = getSafeErrorDetailsService(error)
        expect(details.errorName).toBe('AggregateError')
        expect(details.errorCauses).toHaveLength(5)
        expect(details.aggregateErrors).toHaveLength(5)
        expect(
            details.aggregateErrors?.every(
                (item) => item.errorCode === 'ETIMEDOUT',
            ),
        ).toBe(true)
        expect(JSON.stringify(details)).not.toContain('secret')
    })

    it.each([
        'ERR_POSTGRES_CONNECTION_CLOSED',
        'ERR_POSTGRES_CONNECTION_REFUSED',
        'ERR_POSTGRES_CONNECTION_TIMEOUT',
        'ERR_POSTGRES_TLS_UPGRADE_FAILED',
        'ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2',
        'ERR_POSTGRES_QUERY_CANCELLED',
    ])('erhält Bun-SQL-Diagnosecode %s ohne Query oder Parameter', (code) => {
        const error = new SQL.PostgresError('SQL with private parameters', {
            code,
        })
        expect(getSafeErrorDetailsService(error)).toEqual({
            errorId: expect.any(String),
            errorName: 'PostgresError',
            errorCode: code,
        })
    })

    it('verwirft freie Namen, Codes und SMTP-Texte', () => {
        const details = getSafeErrorDetailsService({
            name: 'recipient@example.test',
            code: '23505 password-hash',
            responseCode: '550 recipient@example.test',
            message: 'secret',
        })
        expect(details).toEqual({
            errorId: expect.any(String),
            errorName: 'UnknownError',
        })
    })

    it('behandelt widerrufene Proxies ohne eine zweite Ausnahme beim Logging', () => {
        const { proxy, revoke } = Proxy.revocable([], {})
        revoke()
        expect(() => getSafeErrorDetailsService(proxy)).not.toThrow()
        expect(() =>
            getSafeErrorDetailsService({ errors: proxy }),
        ).not.toThrow()
        expect(() => getSafeErrorDetailsService({ cause: proxy })).not.toThrow()
    })

    it('führt Aggregate-Getter und toString nicht aus', () => {
        const getter = vi.fn(() => {
            throw new Error('secret')
        })
        const errors = Object.defineProperty(Array.from({ length: 1 }), '0', {
            get: getter,
        })
        const details = getSafeErrorDetailsService({ errors, toString: getter })
        expect(details.aggregateErrors).toEqual([{ errorName: 'UnknownError' }])
        expect(getter).not.toHaveBeenCalled()
    })

    it('übergibt ausschließlich feste Meldung und bekannte Codes an die Jobpersistenz', () => {
        const original = Object.assign(
            new Error('recipient@example.test', {
                cause: new Error('password-hash'),
            }),
            {
                code: 'EAUTH',
                responseCode: 535,
                response: 'SMTP private',
                query: 'insert secret',
                params: ['token'],
            },
        )
        const safe = createSafeErrorForStorageService(
            original,
            'Mail-Job fehlgeschlagen.',
        )
        expect(safe).toBeInstanceOf(Error)
        expect(safe.message).toBe('Mail-Job fehlgeschlagen.')
        expect(safe.stack).toBeUndefined()
        expect(safe.cause).toBeUndefined()
        expect(Object.getOwnPropertyDescriptor(safe, 'code')?.value).toBe(
            'EAUTH',
        )
        expect(
            Object.getOwnPropertyDescriptor(safe, 'responseCode')?.value,
        ).toBe(535)
        expect(Object.getOwnPropertyNames(safe).toSorted()).toEqual([
            'code',
            'message',
            'responseCode',
            'stack',
        ])
        expect(original.message).toBe('recipient@example.test')
        expect(original.cause).toBeInstanceOf(Error)
        expect(original.stack).toBeDefined()
    })

    it('erhält ausdrücklich gewählten nicht retryfähigen Fehlertyp ohne dessen Stack', () => {
        class NonRetryableError extends Error {}
        const safe = createSafeErrorForStorageService(
            new Error('secret'),
            'Ungültiger Job.',
            (message) => new NonRetryableError(message),
        )
        expect(safe).toBeInstanceOf(NonRetryableError)
        expect(safe.message).toBe('Ungültiger Job.')
        expect(safe.stack).toBeUndefined()
    })

    it.each([
        undefined,
        null,
        'token',
        7,
        { code: 'private', responseCode: 999 },
    ])(
        'speichert auch fremde Fehlerwerte ohne freie Zusatzdaten',
        (original) => {
            const safe = createSafeErrorForStorageService(
                original,
                'Job fehlgeschlagen.',
            )
            expect(Object.getOwnPropertyNames(safe).toSorted()).toEqual([
                'message',
                'stack',
            ])
            expect(safe.message).toBe('Job fehlgeschlagen.')
            expect(safe.stack).toBeUndefined()
        },
    )
})
