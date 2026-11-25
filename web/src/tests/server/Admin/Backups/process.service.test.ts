import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { BACKUP_POSTGRES_TIMEOUT_SECONDS } from '@/config/backup.config.ts'

const originalTimeout = process.env.BACKUP_POSTGRES_TIMEOUT_SECONDS
const originalPassword = process.env.PGPASSWORD
const originalDirectory = process.env.POSTGRES_BIN_DIR
const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: unknown,
) {})
vi.mock('@/server/Core/command.service.ts', function () {
    return { runCoreCommandService: command }
})
vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function () {
            return 'postgresql://synthetic-user:synthetic-secret@localhost/synthetic'
        },
    }
})
import {
    createPostgresDump,
    restorePostgresDump,
} from '@/server/Admin/Backups/process.service.ts'

beforeEach(function () {
    command.mockReset()
    process.env.BACKUP_POSTGRES_TIMEOUT_SECONDS = '60'
    process.env.PGPASSWORD = 'synthetic-fallback'
    process.env.POSTGRES_BIN_DIR = '/synthetic/postgres/bin'
})
afterEach(function () {
    for (const [key, value] of [
        ['BACKUP_POSTGRES_TIMEOUT_SECONDS', originalTimeout],
        ['PGPASSWORD', originalPassword],
        ['POSTGRES_BIN_DIR', originalDirectory],
    ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('PostgreSQL-Core-Prozessgrenze', function () {
    it('übergibt die Verbindung im privaten Request und wartet auf den Core-Abschluss', async function () {
        await createPostgresDump('/synthetic/database.dump')
        expect(command).toHaveBeenCalledWith(
            'storage',
            {
                operation: 'postgresDump',
                path: '/synthetic/database.dump',
                databaseUrl:
                    'postgresql://synthetic-user:synthetic-secret@localhost/synthetic',
                fallbackPassword: 'synthetic-fallback',
                binaryDirectory: '/synthetic/postgres/bin',
                timeoutMs: 60_000,
            },
            { timeoutMs: 75_000 },
        )
    })

    it('nutzt dieselbe explizite Prozessgrenze für Restore', async function () {
        await restorePostgresDump('/synthetic/database.dump')
        expect(command.mock.calls[0]?.[1].operation).toBe('postgresRestore')
    })

    it.each(['', '  '])(
        'uses the default timeout for a blank setting (%j)',
        async function (value) {
            process.env.BACKUP_POSTGRES_TIMEOUT_SECONDS = value
            await createPostgresDump('/synthetic/database.dump')
            expect(command.mock.calls[0]?.[1]).toMatchObject({
                timeoutMs: BACKUP_POSTGRES_TIMEOUT_SECONDS.default * 1000,
            })
        },
    )

    it('startet bei ungültigem Zeitlimit keinen Prozess', async function () {
        process.env.BACKUP_POSTGRES_TIMEOUT_SECONDS = 'not-a-timeout'
        await expect(
            createPostgresDump('/synthetic/database.dump'),
        ).rejects.toThrow()
        expect(command).not.toHaveBeenCalled()
    })

    it('erhält die geheimnisfreien nativen Fehlercodes', async function () {
        const error = Object.assign(
            new Error('Die PostgreSQL-Version ist inkompatibel.'),
            { code: 'BACKUP_POSTGRES_VERSION_MISMATCH' },
        )
        command.mockRejectedValue(error)
        await expect(
            createPostgresDump('/synthetic/database.dump'),
        ).rejects.toBe(error)
    })
})
