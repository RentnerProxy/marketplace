import { describe, expect, it } from 'bun:test'
import {
    validateAppProductionEnvironment,
    validateBackupWorkerEnvironment,
    validateDatabaseEnvironment,
} from '@/server/Runtime/environment.service.ts'
import { parseDatabaseEnvironment } from '@/server/Runtime/database-environment.service.ts'

const expectedDatabaseUrl =
    'postgresql://app%40tenant:p%40ss%3A%2F%3F%23%25%20word@db.internal:5432/app%2Fmain'

function createPostgresEnvironment(): Record<string, string> {
    return {
        POSTGRES_HOST: 'db.internal',
        POSTGRES_PORT: '5432',
        POSTGRES_USER: 'app@tenant',
        POSTGRES_PASSWORD: 'p@ss:/?#% word',
        POSTGRES_DB: 'app/main',
    }
}

function createAppEnvironmentWithoutDatabaseUrl() {
    return {
        ...createPostgresEnvironment(),
        APP_STORAGE_DIR: '/app/storage/public',
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        BACKUP_DIR: '/app/backups',
        ORIGIN: 'https://app.example.com',
        VALKEY_URL:
            'rediss://:synthetic-runtime-password@valkey.example.com:6380/1',
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_RANGES: '192.0.2.10/32',
        VITE_APP_VERSION: '1.2.3',
    }
}

describe('Datenbank-Environment', function () {
    it('behält DATABASE_URL als vorrangigen bestehenden Vertrag', function () {
        const databaseUrl = 'postgresql://primary:secret@primary-db/app'
        const validated = parseDatabaseEnvironment({
            DATABASE_URL: databaseUrl,
            POSTGRES_HOST: 'ungueltig/host',
        })

        expect(validated.DATABASE_URL).toBe(databaseUrl)
    })

    it.each(['', '   '])(
        'behandelt eine leere DATABASE_URL als fehlend',
        function (databaseUrl) {
            expect(
                parseDatabaseEnvironment({
                    ...createPostgresEnvironment(),
                    DATABASE_URL: databaseUrl,
                }).DATABASE_URL,
            ).toBe(expectedDatabaseUrl)
        },
    )

    it('leitet eine sicher kodierte DATABASE_URL aus POSTGRES_* ab', function () {
        expect(parseDatabaseEnvironment(createPostgresEnvironment())).toEqual({
            DATABASE_URL: expectedDatabaseUrl,
        })
    })

    it('unterstützt IPv6-Hosts ohne doppelte Klammern', function () {
        const validated = parseDatabaseEnvironment({
            ...createPostgresEnvironment(),
            POSTGRES_HOST: '[2001:db8::1]',
        })

        expect(validated.DATABASE_URL).toContain('@[2001:db8::1]:5432/')
    })

    it('verwendet den abgeleiteten Vertrag in App und Backup-Worker', function () {
        expect(
            validateAppProductionEnvironment(
                createAppEnvironmentWithoutDatabaseUrl(),
            ).DATABASE_URL,
        ).toBe(expectedDatabaseUrl)
        expect(
            validateBackupWorkerEnvironment({
                ...createPostgresEnvironment(),
                AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
                APP_STORAGE_DIR: '/app/storage/public',
                BACKUP_DIR: '/app/backups',
                VALKEY_URL: 'redis://:synthetic-runtime-password@valkey:6379',
                VITE_APP_VERSION: '1.2.3',
            }).DATABASE_URL,
        ).toBe(expectedDatabaseUrl)
    })

    it('setzt die URL für Prozessimporte und entfernt POSTGRES_*', function () {
        const keys = [
            'DATABASE_URL',
            ...Object.keys(createPostgresEnvironment()),
        ]
        const previousValues = new Map(
            keys.map((key) => [key, process.env[key]] as const),
        )

        try {
            delete process.env.DATABASE_URL
            Object.assign(process.env, createPostgresEnvironment())

            validateDatabaseEnvironment()

            expect(process.env.DATABASE_URL ?? '').toBe(expectedDatabaseUrl)
            for (const key of Object.keys(createPostgresEnvironment())) {
                expect(process.env[key]).toBeUndefined()
            }

            const directDatabaseUrl =
                'postgresql://primary:secret@primary-db/app'
            Object.assign(process.env, createPostgresEnvironment(), {
                DATABASE_URL: directDatabaseUrl,
            })

            validateDatabaseEnvironment()

            expect(process.env.DATABASE_URL ?? '').toBe(directDatabaseUrl)
            for (const key of Object.keys(createPostgresEnvironment())) {
                expect(process.env[key]).toBeUndefined()
            }
        } finally {
            for (const [key, value] of previousValues) {
                if (value === undefined) {
                    delete process.env[key]
                } else {
                    process.env[key] = value
                }
            }
        }
    })

    it.each(Object.keys(createPostgresEnvironment()))(
        'fordert die Komponente %s vollständig an',
        function (missingKey) {
            const environment = createPostgresEnvironment()
            delete environment[missingKey]

            expect(() => parseDatabaseEnvironment(environment)).toThrow(
                missingKey,
            )
        },
    )

    it.each([
        ['POSTGRES_HOST', 'db/anderer-pfad'],
        ['POSTGRES_HOST', '999.999.999.999'],
        ['POSTGRES_PORT', '0'],
        ['POSTGRES_PORT', '05432'],
        ['POSTGRES_PORT', '65536'],
        ['POSTGRES_USER', ' app'],
        ['POSTGRES_PASSWORD', ''],
        ['POSTGRES_PASSWORD', 'zeile\numbruch'],
        ['POSTGRES_DB', 'app '],
    ])('lehnt den ungültigen Wert für %s ab', function (key, value) {
        expect(() =>
            parseDatabaseEnvironment({
                ...createPostgresEnvironment(),
                [key]: value,
            }),
        ).toThrow(key)
    })

    it('fordert für manuelle Datenbankaktionen keine fachfremde App-Env', function () {
        expect(() =>
            parseDatabaseEnvironment({
                DATABASE_URL: 'postgresql://app:secret@db/app',
            }),
        ).not.toThrow()
    })
})
