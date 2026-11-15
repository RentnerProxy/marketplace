import { z } from 'zod'
import { isValidTimeZone } from '@/lib/Date/timeZone.ts'
import {
    databaseUrlSchema,
    resolveDatabaseUrlEnvironment,
} from './database-environment.service.ts'
import {
    encryptionKeySchema,
    normalizeOptionalEnvironmentValue,
    valkeyUrlSchema,
} from './environment-schema.service.ts'
import { resolveValkeyUrlEnvironment } from './valkey-environment.service.ts'
import { BACKUP_POSTGRES_TIMEOUT_SECONDS } from '@/config/backup.config.ts'

const optionalTimezoneSchema = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z
        .string()
        .refine(
            isValidTimeZone,
            'BACKUP_TIMEZONE enthält keine gültige IANA-Zeitzone.',
        )
        .optional(),
)

const optionalPostgresCommandTimeoutSchema = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z
        .string()
        .regex(
            /^\d+$/,
            'BACKUP_POSTGRES_TIMEOUT_SECONDS muss eine ganze Zahl sein.',
        )
        .refine(
            (value) =>
                Number(value) >= BACKUP_POSTGRES_TIMEOUT_SECONDS.min &&
                Number(value) <= BACKUP_POSTGRES_TIMEOUT_SECONDS.max,
            `BACKUP_POSTGRES_TIMEOUT_SECONDS muss zwischen ${BACKUP_POSTGRES_TIMEOUT_SECONDS.min} und ${BACKUP_POSTGRES_TIMEOUT_SECONDS.max} Sekunden liegen.`,
        )
        .optional(),
)

const backupDirectorySchema = z
    .string()
    .trim()
    .min(1, 'BACKUP_DIR darf nicht leer sein.')

export const backupEnvironmentSchema = z.object({
    DATABASE_URL: databaseUrlSchema,
    VALKEY_URL: valkeyUrlSchema,
    AUTH_ENCRYPTION_KEY: encryptionKeySchema,
    APP_STORAGE_DIR: z.string().trim().min(1),
    APP_PRIVATE_STORAGE_DIR: z.string().trim().min(1).optional(),
    BACKUP_DIR: backupDirectorySchema,
    BACKUP_TIMEZONE: optionalTimezoneSchema,
    BACKUP_POSTGRES_TIMEOUT_SECONDS: optionalPostgresCommandTimeoutSchema,
    VITE_APP_VERSION: z.string().trim().min(1),
})

const resolvedBackupEnvironmentSchema = z.preprocess(
    resolveBackupRuntimeEnvironment,
    backupEnvironmentSchema,
)

export function parseBackupWorkerEnvironment(environment: unknown) {
    return resolvedBackupEnvironmentSchema.parse(environment)
}

export function resolveBackupRuntimeEnvironment(environment: unknown) {
    return resolveValkeyUrlEnvironment(
        resolveDatabaseUrlEnvironment(environment),
    )
}
