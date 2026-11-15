import { describe, expect, it } from 'bun:test'
import { parseDevelopmentSetupEnvironmentService } from '@/server/Runtime/development-setup-environment.service.ts'

const environment = {
    DATABASE_URL: 'postgresql://dev:synthetic@127.0.0.1:5432/unit_test',
    VALKEY_URL: 'redis://127.0.0.1:6379',
}

describe('development setup environment', function () {
    it('accepts passwordless local Valkey and the default Vite origin', function () {
        expect(parseDevelopmentSetupEnvironmentService(environment)).toEqual({
            ...environment,
            ORIGIN: 'http://localhost:3000',
        })
    })

    it('normalizes PostgreSQL connection parts before bootstrap imports', function () {
        const parsed = parseDevelopmentSetupEnvironmentService({
            VALKEY_URL: environment.VALKEY_URL,
            POSTGRES_HOST: '127.0.0.1',
            POSTGRES_PORT: '5432',
            POSTGRES_USER: 'dev',
            POSTGRES_PASSWORD: 'synthetic',
            POSTGRES_DB: 'unit_test',
            ORIGIN: 'http://localhost:4000',
        })
        expect(parsed.DATABASE_URL).toBe(environment.DATABASE_URL)
        expect(parsed.ORIGIN).toBe('http://localhost:4000')
    })

    it.each(['', 'http://localhost:6379', 'invalid-secret-value'])(
        'rejects missing or invalid Valkey configuration without echoing it',
        function (VALKEY_URL) {
            expect(() =>
                parseDevelopmentSetupEnvironmentService({
                    ...environment,
                    VALKEY_URL,
                }),
            ).toThrow('VALKEY_URL auf eine erreichbare Valkey-Instanz')
        },
    )

    it('reports invalid database configuration without printing its value', function () {
        expect(() =>
            parseDevelopmentSetupEnvironmentService({
                ...environment,
                DATABASE_URL: 'synthetic-private-value',
            }),
        ).toThrow('DATABASE_URL oder eine vollständige POSTGRES-Konfiguration')
    })

    it.each([
        'https://localhost/path',
        'https://user:synthetic@localhost',
        'file:///tmp/test',
    ])(
        'requires an exact public web origin without credentials',
        function (ORIGIN) {
            expect(() =>
                parseDevelopmentSetupEnvironmentService({
                    ...environment,
                    ORIGIN,
                }),
            ).toThrow('ORIGIN muss die http(s)-Origin')
        },
    )

    it('rejects use as a production startup path', function () {
        expect(() =>
            parseDevelopmentSetupEnvironmentService({
                ...environment,
                NODE_ENV: 'production',
            }),
        ).toThrow('darf nicht in Produktion')
    })
})
