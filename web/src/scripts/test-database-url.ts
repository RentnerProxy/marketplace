import { runNativeToolSync } from '@/lib/Core/native-tool.ts'
import type { Environment } from '@/server/Runtime/Types/environment.types.ts'

export function isTestDatabaseName(databaseName: string) {
    return runNativeToolSync<boolean>(
        'marketplace-tooling',
        'verification-db-name',
        {
            name: databaseName,
        },
    )
}

export function getTestDatabaseUrl(environment: Environment = process.env) {
    const value = environment.TEST_DATABASE_URL?.trim()

    if (!value) {
        throw new Error(
            'TEST_DATABASE_URL muss für die Vorbereitung explizit gesetzt sein.',
        )
    }

    let databaseUrl: URL
    try {
        databaseUrl = new URL(value)
    } catch {
        throw new Error('TEST_DATABASE_URL ist keine gültige URL.')
    }
    const { protocol, hostname, pathname } = databaseUrl
    const databaseName = runNativeToolSync<string>(
        'marketplace-tooling',
        'verification-db-target',
        { protocol, hostname, pathname, ci: environment.CI === 'true' },
    )

    return { databaseName, value }
}

export function verifyTestDatabaseTarget(databaseUrl: URL) {
    const { protocol, pathname } = databaseUrl
    runNativeToolSync('marketplace-tooling', 'verification-db-test-target', {
        protocol,
        pathname,
    })
}
