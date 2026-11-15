import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test'

const databaseUrl =
    'postgresql://postgres:synthetic-password@db.invalid/app_test'
const result = {
    permissions: [{ id: 'permission-1', key: 'admin.super-user' }],
    syncedPermissions: 1,
    grantedAssignments: 0,
    removedPermissions: 0,
}
const events: string[] = []
const failures = new Map<string, Error>()
const configuration = { databaseSchema: 'app_test' }
const transaction = { identity: 'scoped-transaction' }
let pendingLock: Promise<void> | undefined

function record(step: string) {
    events.push(step)
    const error = failures.get(step)
    if (error) throw error
}

const unsafe = vi.fn(async function (
    statement: string,
    _parameters?: number[],
) {
    if (statement.includes('pg_advisory_unlock')) {
        record('unlock')
    } else if (statement.includes('pg_advisory_lock')) {
        record('lock')
        await pendingLock
        events.push('locked')
    } else {
        throw new Error('Unexpected initialization SQL: ' + statement)
    }
    return []
})
const release = vi.fn(async function () {
    record('release')
})
const reserved = { unsafe, release }
const reserve = vi.fn(async function () {
    record('reserve')
    return reserved
})
const close = vi.fn(async function (_options: { timeout: number }) {
    record('close')
})
const construct = vi.fn(function (_url: string, _options: unknown) {
    record('construct')
})
class MockSql {
    constructor(url: string, options: unknown) {
        construct(url, options)
    }
    reserve() {
        return reserve()
    }
    close(options: { timeout: number }) {
        return close(options)
    }
}
const database = {
    transaction: vi.fn(async function (
        operation: (value: typeof transaction) => Promise<typeof result>,
    ) {
        record('transaction')
        try {
            const value = await operation(transaction)
            events.push('commit')
            return value
        } catch (error) {
            events.push('rollback')
            throw error
        }
    }),
}
const drizzle = vi.fn(function (_client: unknown, _options: unknown) {
    record('drizzle')
    return database
})
const migrate = vi.fn(async function (_database: unknown, _options: unknown) {
    record('migrate')
})
const syncPermissions = vi.fn(async function (
    _transaction: unknown,
    _options: unknown,
) {
    record('permissions')
    return result
})
const assertPolicy = vi.fn(async function (_url: string) {
    record('policy')
})
const logInfo = vi.fn()
const logWarnError = vi.fn()

vi.mock('drizzle-orm/bun-sql', () => ({ drizzle }))
vi.mock('drizzle-orm/bun-sql/migrator', () => ({ migrate }))
vi.mock('@/db/schema.ts', () => ({}))
vi.mock('@/config/app.config.ts', () => ({ PROJECT_CONFIG: configuration }))
vi.mock('@/server/SystemBootstrap/permissions.service.ts', () => ({
    syncDefaultPermissions: syncPermissions,
}))
vi.mock('@/server/Runtime/database-role-policy.service.ts', () => ({
    assertRuntimeDatabaseRolePolicyService: assertPolicy,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logInfo, logWarnError }))

// Coverage resolves the built-in SQL import through the global Bun namespace.
const sqlExports = Bun as unknown as {
    SQL: (url: string, options: unknown) => MockSql
}
const sqlConstructor = vi.spyOn(sqlExports, 'SQL')
sqlConstructor.mockImplementation((url, options) => new MockSql(url, options))
const { runDatabaseInitializationService: initialize } =
    await import('@/server/SystemBootstrap/database-initialization.service.ts')

beforeEach(function () {
    vi.clearAllMocks()
    events.length = 0
    failures.clear()
    pendingLock = undefined
    configuration.databaseSchema = 'app_test'
})
afterAll(function () {
    sqlConstructor.mockRestore()
})

describe('Serialisierte Datenbankinitialisierung', function () {
    it('prüft die Rolle und hält Migration sowie Rechte auf derselben gesperrten Verbindung', async function () {
        expect(await initialize(databaseUrl)).toBe(result)
        expect(events).toEqual([
            'policy',
            'construct',
            'reserve',
            'lock',
            'locked',
            'drizzle',
            'migrate',
            'transaction',
            'permissions',
            'commit',
            'unlock',
            'release',
            'close',
        ])
        expect(construct).toHaveBeenCalledWith(databaseUrl, {
            max: 1,
            idleTimeout: 0,
            maxLifetime: 0,
        })
        expect(drizzle).toHaveBeenCalledWith(reserved, { schema: {} })
        expect(migrate).toHaveBeenCalledWith(database, {
            migrationsFolder: './web/drizzle',
        })
        expect(syncPermissions).toHaveBeenCalledWith(transaction, {
            prune: false,
            grantAdminPermissionsToSuperUsers: true,
        })
        expect(unsafe.mock.calls[0]).toEqual([
            'SELECT pg_catalog.pg_advisory_lock($1, $2)',
            [1_414_743_123, 1],
        ])
        expect(unsafe.mock.calls.at(-1)).toEqual([
            'SELECT pg_catalog.pg_advisory_unlock($1, $2)',
            [1_414_743_123, 1],
        ])
        expect(close).toHaveBeenCalledWith({ timeout: 0 })
    })

    it('führt beim Warten auf den Advisory-Lock keine Schema- oder Rechteänderungen aus', async function () {
        let unlockWaiting: (() => void) | undefined
        let markWaiting: (() => void) | undefined
        const waiting = new Promise<void>((resolve) => {
            markWaiting = resolve
        })
        pendingLock = new Promise<void>((resolve) => {
            unlockWaiting = resolve
        })
        const original = unsafe.getMockImplementation()!
        unsafe.mockImplementationOnce(async function (statement, parameters) {
            const operation = original(statement, parameters)
            markWaiting?.()
            return operation
        })
        const operation = initialize(databaseUrl)
        await waiting
        expect(events).toEqual(['policy', 'construct', 'reserve', 'lock'])
        expect(drizzle).not.toHaveBeenCalled()
        expect(migrate).not.toHaveBeenCalled()
        expect(syncPermissions).not.toHaveBeenCalled()
        expect(release).not.toHaveBeenCalled()
        unlockWaiting?.()
        expect(await operation).toBe(result)
    })

    it('wartet auf die Freigabe der reservierten Verbindung, bevor es den Client schließt', async function () {
        const releasing = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        release.mockImplementationOnce(async function () {
            record('release')
            releasing.resolve()
            await released.promise
            events.push('released')
        })

        const operation = initialize(databaseUrl, 'permissions')
        await releasing.promise
        expect(close).not.toHaveBeenCalled()
        released.resolve()

        expect(await operation).toBe(result)
        expect(events.slice(-4)).toEqual([
            'unlock',
            'release',
            'released',
            'close',
        ])
    })

    it.each(['migration', 'permissions', 'production'] as const)(
        'erhält den Vertrag des Modus %s',
        async function (mode) {
            expect(await initialize(databaseUrl, mode)).toBe(
                mode === 'migration' ? null : result,
            )
            expect(migrate).toHaveBeenCalledTimes(
                mode === 'permissions' ? 0 : 1,
            )
            expect(syncPermissions).toHaveBeenCalledTimes(
                mode === 'migration' ? 0 : 1,
            )
            expect(unsafe.mock.calls.map(([statement]) => statement)).toEqual([
                'SELECT pg_catalog.pg_advisory_lock($1, $2)',
                'SELECT pg_catalog.pg_advisory_unlock($1, $2)',
            ])
            expect(events.slice(-3)).toEqual(['unlock', 'release', 'close'])
        },
    )

    it('verwendet bei wiederholten Deployments dieselben Lockschlüssel und nicht löschende Rechteoptionen', async function () {
        await initialize(databaseUrl)
        await initialize(databaseUrl)
        expect(migrate).toHaveBeenCalledTimes(2)
        expect(syncPermissions).toHaveBeenCalledTimes(2)
        const locks = unsafe.mock.calls.filter(([statement]) =>
            statement.includes('pg_advisory_lock('),
        )
        expect(locks).toEqual([locks[0], locks[0]])
        for (const [, options] of syncPermissions.mock.calls) {
            expect(options).toEqual({
                prune: false,
                grantAdminPermissionsToSuperUsers: true,
            })
        }
        expect(release).toHaveBeenCalledTimes(2)
        expect(close).toHaveBeenCalledTimes(2)
    })

    it('öffnet bei fehlgeschlagener Rollenprüfung keine Initialisierungsverbindung', async function () {
        const error = new Error('Synthetic policy failure')
        failures.set('policy', error)
        await expect(initialize(databaseUrl)).rejects.toBe(error)
        expect(construct).not.toHaveBeenCalled()
        expect(migrate).not.toHaveBeenCalled()
        expect(syncPermissions).not.toHaveBeenCalled()
    })

    it.each(['reserve', 'lock', 'migrate', 'permissions'])(
        'beendet nach Fehler in %s alle verfügbaren Verbindungen',
        async function (step) {
            const error = new Error('Synthetic ' + step + ' failure')
            failures.set(step, error)
            await expect(initialize(databaseUrl)).rejects.toBe(error)
            expect(close).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledTimes(step === 'reserve' ? 0 : 1)
            expect(events.filter((event) => event === 'unlock')).toHaveLength(
                ['reserve', 'lock'].includes(step) ? 0 : 1,
            )
            if (step !== 'permissions')
                expect(syncPermissions).not.toHaveBeenCalled()
            if (step === 'permissions') expect(events).toContain('rollback')
        },
    )

    it.each(['unlock', 'release', 'close'])(
        'meldet einen Bereinigungsfehler in %s trotz erfolgreicher Initialisierung',
        async function (step) {
            const error = new Error('Synthetic cleanup failure')
            failures.set(step, error)
            await expect(initialize(databaseUrl)).rejects.toBe(error)
            expect(close).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledTimes(1)
            expect(logWarnError).not.toHaveBeenCalled()
            expect(
                logInfo.mock.calls.some(
                    ([event]) => event === 'database.initialization_completed',
                ),
            ).toBe(false)
        },
    )

    it.each(['unlock', 'release', 'close'])(
        'erhält den ursprünglichen Fehler bei zusätzlichem Bereinigungsfehler in %s',
        async function (step) {
            const original = new Error('Synthetic migration failure')
            const cleanup = new Error('Synthetic cleanup failure')
            failures.set('migrate', original)
            failures.set(step, cleanup)
            await expect(initialize(databaseUrl)).rejects.toBe(original)
            expect(close).toHaveBeenCalledTimes(1)
            expect(logWarnError).toHaveBeenCalledWith(
                'database.initialization_cleanup_failed',
                cleanup,
                { mode: 'production' },
            )
        },
    )

    it.each([
        'public',
        'pg_catalog',
        'invalid-schema',
        'app";DROP SCHEMA public;--',
    ])(
        'verweigert das ungültige Anwendungsschema %s vor dem Migrator',
        async function (name) {
            configuration.databaseSchema = name
            await expect(initialize(databaseUrl)).rejects.toThrow(
                'Ungültiger PostgreSQL-Identifier',
            )
            expect(migrate).not.toHaveBeenCalled()
            expect(syncPermissions).not.toHaveBeenCalled()
            expect(events.slice(-3)).toEqual(['unlock', 'release', 'close'])
        },
    )
})
