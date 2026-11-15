import { describe, expect, it } from 'bun:test'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { getTestDatabaseUrl } from '@/scripts/test-database-url.ts'

const testDatabaseName = `${PROJECT_CONFIG.databaseName}_test`
const loopbackDatabaseUrl = `postgresql://postgres:test@127.0.0.1:5432/${testDatabaseName}`
const ciDatabaseUrl = `postgresql://postgres:test@postgres:5432/${testDatabaseName}`

describe('Testdatenbank-URL', function () {
    it('erlaubt eine eindeutig benannte Loopback-Testdatenbank', function () {
        expect(
            getTestDatabaseUrl({ TEST_DATABASE_URL: loopbackDatabaseUrl }),
        ).toEqual({
            databaseName: testDatabaseName,
            value: loopbackDatabaseUrl,
        })
    })

    it('erlaubt den isolierten PostgreSQL-Service ausschließlich in CI', function () {
        expect(
            getTestDatabaseUrl({
                CI: 'true',
                TEST_DATABASE_URL: ciDatabaseUrl,
            }),
        ).toEqual({
            databaseName: testDatabaseName,
            value: ciDatabaseUrl,
        })

        expect(() =>
            getTestDatabaseUrl({ TEST_DATABASE_URL: ciDatabaseUrl }),
        ).toThrow('isolierte CI-Testdatenbank')
    })

    it('lehnt andere Netzwerkhosts auch in CI ab', function () {
        expect(() =>
            getTestDatabaseUrl({
                CI: 'true',
                TEST_DATABASE_URL: `postgresql://postgres:test@database.example.com:5432/${testDatabaseName}`,
            }),
        ).toThrow('isolierte CI-Testdatenbank')
    })

    it('lehnt nicht eindeutig benannte Testdatenbanken ab', function () {
        expect(() =>
            getTestDatabaseUrl({
                TEST_DATABASE_URL:
                    'postgresql://postgres:test@127.0.0.1:5432/production',
            }),
        ).toThrow('eindeutig benannte PostgreSQL-Testdatenbank')
    })
})
