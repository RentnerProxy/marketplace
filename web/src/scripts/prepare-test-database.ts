import { SQL } from 'bun'
import { runDatabaseInitializationService } from '@/server/SystemBootstrap/database-initialization.service.ts'
import {
    getTestDatabaseUrl,
    isTestDatabaseName,
} from '@/scripts/test-database-url.ts'

async function prepareTestDatabase() {
    const { databaseName, value } = getTestDatabaseUrl()
    const client = new SQL(value)

    try {
        const databaseRows = await client`
            SELECT current_database() AS "databaseName"
        `
        const connectedDatabaseName = databaseRows.at(0)?.databaseName

        if (
            connectedDatabaseName !== databaseName ||
            !isTestDatabaseName(String(connectedDatabaseName))
        ) {
            throw new Error(
                'Die verbundene Datenbank stimmt nicht mit der freigegebenen Testdatenbank überein.',
            )
        }
    } finally {
        await client.close()
    }

    await runDatabaseInitializationService(value, 'migration')
}

await prepareTestDatabase()
console.log('Isolierte PostgreSQL-Testdatenbank ist vorbereitet.')
