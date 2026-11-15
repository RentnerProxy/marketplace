import { parseDatabaseEnvironment } from '@/server/Runtime/database-environment.service.ts'
import { valkeyUrlSchema } from '@/server/Runtime/environment-schema.service.ts'
import type { Environment } from '@/server/Runtime/Types/environment.types.ts'

export function parseDevelopmentSetupEnvironmentService(environment: Environment) {
    if (environment.NODE_ENV === 'production') {
        throw new Error('Der Development-Server darf nicht in Produktion gestartet werden.')
    }

    let databaseUrl: string
    try {
        databaseUrl = parseDatabaseEnvironment(environment).DATABASE_URL
    } catch {
        throw new Error('Für die lokale Entwicklung muss DATABASE_URL oder eine vollständige POSTGRES-Konfiguration gesetzt sein.')
    }

    const valkey = valkeyUrlSchema.safeParse(environment.VALKEY_URL)
    if (!valkey.success) {
        throw new Error('Für die lokale Entwicklung muss VALKEY_URL auf eine erreichbare Valkey-Instanz zeigen (redis: oder rediss:).')
    }

    const origin = environment.ORIGIN?.trim() || 'http://localhost:3000'
    try {
        const url = new URL(origin)
        if (!['http:', 'https:'].includes(url.protocol) || origin !== url.origin || url.username || url.password) {
            throw new Error('Invalid origin')
        }
    } catch {
        throw new Error('ORIGIN muss die http(s)-Origin des lokalen Webservers ohne Pfad oder Zugangsdaten sein.')
    }

    return { DATABASE_URL: databaseUrl, VALKEY_URL: valkey.data, ORIGIN: origin }
}
