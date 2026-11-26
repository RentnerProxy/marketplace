import { expect, it } from 'bun:test'
import { getTableName, is, sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { PgTable } from 'drizzle-orm/pg-core'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { db } from '@/db'
import * as schema from '@/db/schema.ts'

it('prepares every application table and records every Drizzle migration', async function () {
    const tables = await db.execute<{ tableName: string }>(sql`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = ${PROJECT_CONFIG.databaseSchema}
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `)
    const expectedTables = Object.values(schema)
        .filter((model) => is(model, PgTable))
        .map(getTableName)
        .toSorted()
    expect(tables.map((row) => row.tableName)).toEqual(expectedTables)

    const [journal] = await db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `)
    expect(journal?.count).toBe(
        readMigrationFiles({ migrationsFolder: './web/drizzle' }).length,
    )
})

it('applies the expected index key order and replaces the standalone notification read index', async function () {
    const expected = [
        ['notifications_user_id_created_at_idx', '"userId", "createdAt"'],
        ['notifications_user_id_is_read_idx', '"userId", "isRead"'],
        ['permission_preset_permissions_permission_id_idx', '"permissionId"'],
        ['staff_user_permissions_permission_id_idx', '"permissionId"'],
        ['public_user_permissions_permission_id_idx', '"permissionId"'],
        ['sessions_user_id_expires_at_idx', '"userId", "expiresAt"'],
        [
            'audit_logs_actor_user_id_created_at_idx',
            '"actorUserId", "createdAt"',
        ],
        ['audit_logs_action_created_at_idx', 'action, "createdAt"'],
    ]
    const indexes = await db.execute<{
        indexname: string
        indexdef: string
    }>(sql`
        SELECT indexname, indexdef
        FROM pg_catalog.pg_indexes
        WHERE schemaname = ${PROJECT_CONFIG.databaseSchema}
    `)
    const byName = new Map(
        indexes.map((index) => [index.indexname, index.indexdef]),
    )
    for (const [name, keys] of expected) {
        expect(byName.get(name)).toContain(`USING btree (${keys})`)
    }
    expect(byName.has('notifications_is_read_idx')).toBe(false)
})

it('passes the configured pool settings and process name to the real Bun SQL client', async function () {
    const program = `
        const { db, closeDatabaseConnection } = await import('./web/src/db/index.ts')
        try {
            const [row] = await db.execute("SELECT current_setting('application_name') AS name")
            const { max, idleTimeout, maxLifetime, connectionTimeout } = db.$client.options
            console.log(JSON.stringify({ max, idleTimeout, maxLifetime, connectionTimeout, name: row.name }))
        } finally {
            await closeDatabaseConnection()
        }
    `
    const sqlClient = Bun.spawn(
        [process.execPath, '--no-env-file', '-e', program],
        {
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                DATABASE_URL: process.env.TEST_DATABASE_URL,
                DATABASE_POOL_MAX: '6',
                DATABASE_POOL_IDLE_TIMEOUT_SECONDS: '21',
                DATABASE_POOL_MAX_LIFETIME_SECONDS: '900',
                DATABASE_POOL_CONNECTION_TIMEOUT_SECONDS: '4',
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'ignore',
        },
    )
    const [exitCode, output] = await Promise.all([
        sqlClient.exited,
        new Response(sqlClient.stdout).text(),
    ])
    expect(exitCode).toBe(0)
    expect(JSON.parse(output)).toEqual({
        max: 6,
        idleTimeout: 21_000,
        maxLifetime: 900_000,
        connectionTimeout: 4_000,
        name: PROJECT_CONFIG.packageName + '-web',
    })
})
