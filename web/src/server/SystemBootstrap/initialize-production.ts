import { logError } from '@/server/Logging/logger.ts'
import { validateDatabaseEnvironment } from '@/server/Runtime/environment.service.ts'
import { runDatabaseInitializationService } from './database-initialization.service.ts'

process.env.NODE_ENV = 'production'

try {
    const { DATABASE_URL } = validateDatabaseEnvironment()
    await runDatabaseInitializationService(DATABASE_URL)
} catch (error) {
    logError('database.initialization_failed', error)
    process.exitCode = 1
}
