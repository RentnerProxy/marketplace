import type { Environment } from './Types/environment.types.ts'
import { parseAppProductionEnvironment } from './app-environment.service.ts'
import { parseBackupWorkerEnvironment } from './backup-environment.service.ts'
import { parseDatabaseEnvironment } from './database-environment.service.ts'
import { parseMailWorkerEnvironment } from './mail-environment.service.ts'

const postgresConnectionEnvironmentKeys = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
] as const

const valkeyConnectionEnvironmentKeys = [
    'VALKEY_PASSWORD',
    'VALKEY_PASSWORD_FILE',
] as const

function applyValidatedEnvironment(
    source: Environment,
    validated: Record<string, unknown>,
) {
    if (source !== process.env) {
        return
    }

    const databaseEnvironmentWasValidated =
        typeof validated.DATABASE_URL === 'string'
    const valkeyEnvironmentWasValidated =
        typeof validated.VALKEY_URL === 'string'

    for (const [key, value] of Object.entries(validated)) {
        if (typeof value === 'string') {
            process.env[key] = value
        } else if (value === undefined) {
            delete process.env[key]
        }
    }

    if (databaseEnvironmentWasValidated) {
        for (const key of postgresConnectionEnvironmentKeys) {
            delete process.env[key]
        }
    }

    if (valkeyEnvironmentWasValidated) {
        for (const key of valkeyConnectionEnvironmentKeys) {
            delete process.env[key]
        }
    }
}

export function validateAppProductionEnvironment(
    environment: Environment = process.env,
) {
    const validated = parseAppProductionEnvironment(environment)
    applyValidatedEnvironment(environment, validated)
    return validated
}

export function validateDatabaseEnvironment(
    environment: Environment = process.env,
) {
    const validated = parseDatabaseEnvironment(environment)
    applyValidatedEnvironment(environment, validated)
    return validated
}

export function validateMailWorkerEnvironment(
    environment: Environment = process.env,
) {
    const validated = parseMailWorkerEnvironment(environment)
    applyValidatedEnvironment(environment, validated)
    return validated
}

export function validateBackupWorkerEnvironment(
    environment: Environment = process.env,
) {
    const validated = parseBackupWorkerEnvironment(environment)
    applyValidatedEnvironment(environment, validated)
    return validated
}

export function getRequiredServerEnvironment(key: string) {
    const value = process.env[key]?.trim()

    if (!value) {
        throw new Error(`${key} ist nicht in der Env konfiguriert.`)
    }

    return value
}
