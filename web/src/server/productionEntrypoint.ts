import { validateAppProductionEnvironment } from '@/server/Runtime/environment.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { waitForValkeyPasswordFileService } from '@/server/Runtime/valkey-password-file.service.ts'
import { runDatabaseInitializationService } from '@/server/SystemBootstrap/database-initialization.service.ts'

process.env.NODE_ENV = 'production'

async function initializeApplication() {
    try {
        await waitForValkeyPasswordFileService()
        const environment = validateAppProductionEnvironment()
        await runDatabaseInitializationService(environment.DATABASE_URL)
        return true
    } catch (error) {
        logError('production.startup_failed', error)
        process.exitCode = 1
        return false
    }
}

if (await initializeApplication()) {
    await import('@/server/productionServer.ts')
}
