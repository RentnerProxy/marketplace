import path from 'node:path'
import { mkdtemp, rm, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterAll, mock } from 'bun:test'
import { verifyTestDatabaseTarget } from '@/scripts/test-database-url.ts'

const mkdtempAsync = promisify(mkdtemp)
const rmAsync = promisify(rm)

function getRequiredTestDatabaseUrl() {
    const value = process.env.TEST_DATABASE_URL?.trim()

    if (!value) {
        throw new Error(
            'DB-Tests benötigen eine explizite TEST_DATABASE_URL. DATABASE_URL und .env-Dateien werden aus Sicherheitsgründen nicht verwendet.',
        )
    }

    let databaseUrl: URL

    try {
        databaseUrl = new URL(value)
    } catch {
        throw new Error('TEST_DATABASE_URL ist keine gültige URL.')
    }

    verifyTestDatabaseTarget(databaseUrl)
    return value
}

delete process.env.DATABASE_URL
delete process.env.APP_STORAGE_DIR
delete process.env.APP_PRIVATE_STORAGE_DIR

const testDatabaseUrl = getRequiredTestDatabaseUrl()
const testStorageDir = await mkdtempAsync(path.join(tmpdir(), 'app-db-tests-'))

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = testDatabaseUrl
process.env.APP_STORAGE_DIR = testStorageDir
process.env.APP_PRIVATE_STORAGE_DIR = path.join(testStorageDir, 'private')

mock.module('@/db', function () {
    return import('./testDatabase.ts')
})

function removeTestStorageSync() {
    rmSync(testStorageDir, { force: true, recursive: true })
}

process.once('exit', removeTestStorageSync)

afterAll(async function () {
    const cleanupErrors: Array<Error> = []

    try {
        const { closeTestDatabase } = await import('./testDatabase.ts')
        await closeTestDatabase()
    } catch (error) {
        cleanupErrors.push(
            error instanceof Error ? error : new Error(String(error)),
        )
    }

    try {
        await rmAsync(testStorageDir, { force: true, recursive: true })
    } catch (error) {
        cleanupErrors.push(
            error instanceof Error ? error : new Error(String(error)),
        )
    } finally {
        process.off('exit', removeTestStorageSync)
    }

    if (cleanupErrors.length > 0) {
        throw new AggregateError(
            cleanupErrors,
            'DB-Testressourcen konnten nicht vollständig freigegeben werden.',
        )
    }
})
