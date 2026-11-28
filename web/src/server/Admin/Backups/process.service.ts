import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { getPostgresCommandTimeoutMs } from '@/server/Runtime/backup-environment.service.ts'

async function runPostgresCommand(
    operation: 'postgresDump' | 'postgresRestore',
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
