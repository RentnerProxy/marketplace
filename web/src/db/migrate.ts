import { logError } from '@/server/Logging/logger.ts'
import { validateDatabaseEnvironment } from '@/server/Runtime/environment.service.ts'
import { runDatabaseInitializationService } from '@/server/SystemBootstrap/database-initialization.service.ts'

try {
    const { DATABASE_URL } = validateDatabaseEnvironment()
    console.log('Running migrations...')
    await runDatabaseInitializationService(DATABASE_URL, 'migration')
    console.log('Migrations completed!')
} catch (error) {
    logError('database.migration_failed', error)
    process.exitCode = 1
}
