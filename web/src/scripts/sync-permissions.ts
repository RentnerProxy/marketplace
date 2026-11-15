import { logError } from '@/server/Logging/logger.ts'
import { validateDatabaseEnvironment } from '@/server/Runtime/environment.service.ts'
import { runDatabaseInitializationService } from '@/server/SystemBootstrap/database-initialization.service.ts'

try {
    const { DATABASE_URL } = validateDatabaseEnvironment()
    const result = await runDatabaseInitializationService(
        DATABASE_URL,
        'permissions',
    )

    if (result) {
        console.log(
            [
                `${result.syncedPermissions} Rechte synchronisiert`,
                `${result.grantedAssignments} neue Superuser-Zuweisungen angelegt`,
            ].join(' · '),
        )
    }
} catch (error) {
    logError('database.permissions_sync_failed', error)
    process.exitCode = 1
}
