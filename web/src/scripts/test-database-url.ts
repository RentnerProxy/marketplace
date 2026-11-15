import type { Environment } from '@/server/Runtime/Types/environment.types.ts'
const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])test(?:[_-]|$)/i
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const CI_POSTGRES_SERVICE_HOST = 'postgres'

export function isTestDatabaseName(databaseName: string) {
    return TEST_DATABASE_NAME_PATTERN.test(databaseName)
}

export function getTestDatabaseUrl(environment: Environment = process.env) {
    const value = environment.TEST_DATABASE_URL?.trim()

    if (!value) {
        throw new Error(
            'TEST_DATABASE_URL muss für die Vorbereitung explizit gesetzt sein.',
        )
    }

    const databaseUrl = new URL(value)
    const databaseName = decodeURIComponent(databaseUrl.pathname).replace(
        /^\/+/,
        '',
    )

    if (
        !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
        !isTestDatabaseName(databaseName)
    ) {
        throw new Error(
            'TEST_DATABASE_URL muss auf eine eindeutig benannte PostgreSQL-Testdatenbank zeigen.',
        )
    }

    const isLoopbackHost = LOOPBACK_HOSTS.has(databaseUrl.hostname)
    const isIsolatedCiService =
        environment.CI === 'true' &&
        databaseUrl.hostname === CI_POSTGRES_SERVICE_HOST

    if (!isLoopbackHost && !isIsolatedCiService) {
        throw new Error(
            'Die automatische Vorbereitung ist ausschließlich für eine lokale oder isolierte CI-Testdatenbank erlaubt.',
        )
    }

    return { databaseName, value }
}
