import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { BACKUP_POSTGRES_TIMEOUT_SECONDS } from '@/config/backup.config.ts'
import type { PostgresCoreOperation } from './Types/postgres-process.types.ts'

function getPostgresCommandTimeoutMs() {
    const configured =
        process.env.BACKUP_POSTGRES_TIMEOUT_SECONDS?.trim() ??
        String(BACKUP_POSTGRES_TIMEOUT_SECONDS.default)
    const seconds = Number(configured)
    if (
        !/^\d+$/.test(configured) ||
        !Number.isSafeInteger(seconds) ||
        seconds < BACKUP_POSTGRES_TIMEOUT_SECONDS.min ||
        seconds > BACKUP_POSTGRES_TIMEOUT_SECONDS.max
    )
        throw new Error(
            `BACKUP_POSTGRES_TIMEOUT_SECONDS muss zwischen ${BACKUP_POSTGRES_TIMEOUT_SECONDS.min} und ${BACKUP_POSTGRES_TIMEOUT_SECONDS.max} Sekunden liegen.`,
        )
    return seconds * 1000
}

async function runPostgresCommand(
    operation: PostgresCoreOperation,
    filePath: string,
) {
    const timeoutMs = getPostgresCommandTimeoutMs()
    await runCoreCommandService(
        'storage',
        {
            operation,
            path: filePath,
            databaseUrl: getRequiredServerEnvironment('DATABASE_URL'),
            fallbackPassword: process.env.PGPASSWORD,
            binaryDirectory: process.env.POSTGRES_BIN_DIR,
            timeoutMs,
        },
        { timeoutMs: timeoutMs + 15_000 },
    )
}

export async function createPostgresDump(outputPath: string) {
    await runPostgresCommand('postgresDump', outputPath)
}

export async function restorePostgresDump(inputPath: string) {
    await runPostgresCommand('postgresRestore', inputPath)
}
