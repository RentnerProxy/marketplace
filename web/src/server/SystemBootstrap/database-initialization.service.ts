import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import * as schema from '@/db/schema.ts'
import { logInfo, logWarnError } from '@/server/Logging/logger.ts'
import { assertRuntimeDatabaseRolePolicyService } from '@/server/Runtime/database-role-policy.service.ts'
import { syncDefaultPermissions } from './permissions.service.ts'

// Keep these keys stable so manual commands and different releases serialize.
const initializationLockNamespace = 1_414_743_123
const initializationLockId = 1

function assertApplicationSchemaIdentifier(identifier: string) {
    if (
        !/^[a-z_][a-z0-9_]*$/i.test(identifier) ||
        identifier.startsWith('pg_') ||
        [
            'public',
            'drizzle',
            'information_schema',
            'pg_toast',
            'postgres',
            'template0',
            'template1',
            'none',
            'all',
            'current_user',
            'session_user',
        ].includes(identifier)
    ) {
        throw new Error(`Ungültiger PostgreSQL-Identifier: ${identifier}`)
    }
}

export async function runDatabaseInitializationService(
    databaseUrl: string,
    mode: 'migration' | 'permissions' | 'production' = 'production',
) {
    logInfo('database.initialization_started', { mode })
    await assertRuntimeDatabaseRolePolicyService(databaseUrl)

    const client = new SQL(databaseUrl, {
        max: 1,
        idleTimeout: 0,
        maxLifetime: 0,
    })
    let reserved: Awaited<ReturnType<SQL['reserve']>> | undefined
    let result: Awaited<ReturnType<typeof syncDefaultPermissions>> | null = null
    let lockAcquired = false
    let failure: { error: unknown } | undefined

    try {
        reserved = await client.reserve()
        await reserved.unsafe('SELECT pg_catalog.pg_advisory_lock($1, $2)', [
            initializationLockNamespace,
            initializationLockId,
        ])
        lockAcquired = true
        logInfo('database.initialization_lock_acquired', { mode })

        const database = drizzle(reserved, { schema })

        if (mode !== 'permissions') {
            logInfo('database.migration_started')
            assertApplicationSchemaIdentifier(PROJECT_CONFIG.databaseSchema)
            await migrate(database, { migrationsFolder: './web/drizzle' })
            logInfo('database.migration_completed')
        }

        if (mode !== 'migration') {
            logInfo('database.permissions_sync_started')
            result = await database.transaction((transaction) =>
                syncDefaultPermissions(transaction, {
                    prune: false,
                    grantAdminPermissionsToSuperUsers: true,
                }),
            )
        }
    } catch (error) {
        failure = { error }
    } finally {
        try {
            try {
                if (reserved && lockAcquired) {
                    await reserved.unsafe(
                        'SELECT pg_catalog.pg_advisory_unlock($1, $2)',
                        [initializationLockNamespace, initializationLockId],
                    )
                }
            } finally {
                try {
                    await reserved?.release()
                } finally {
                    await client.close({ timeout: 0 })
                }
            }
        } catch (error) {
            if (failure) {
                logWarnError('database.initialization_cleanup_failed', error, {
                    mode,
                })
            } else {
                failure = { error }
            }
        }
    }

    if (failure) throw failure.error

    logInfo('database.initialization_completed', {
        mode,
        syncedPermissions: result?.syncedPermissions ?? 0,
        grantedAssignments: result?.grantedAssignments ?? 0,
    })
    return result
}
