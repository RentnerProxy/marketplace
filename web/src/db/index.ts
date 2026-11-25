import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import { basename } from 'node:path'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import * as schema from './schema.ts'

declare global {
    var appDatabaseConnection: { close: () => Promise<void> } | undefined
}

function readPoolSetting(
    name: string,
    fallback: number,
    min: number,
    max: number,
) {
    const configured = process.env[name]?.trim()
    if (!configured) return fallback
    const value = Number(configured)
    if (!/^\d+$/.test(configured) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}.`)
    }
    return value
}

function getDatabaseApplicationRole() {
    const entrypoint = basename(Bun.main)
    if (
        entrypoint.startsWith('productionWorkerEntrypoint.') ||
        entrypoint.startsWith('backgroundWorker.')
    )
        return 'worker'
    if (
        entrypoint.startsWith('productionEntrypoint.') ||
        entrypoint.startsWith('productionServer.')
    )
        return 'proxy'
    if (entrypoint.startsWith('realtimeDevServer.')) return 'realtime'
    return 'web'
}

// Keep timeout conversion within the runtime's signed 32-bit timer range.
const maxPoolTimeoutSeconds = Math.floor(2_147_483_647 / 1_000)
const client = new SQL({
    url: process.env.DATABASE_URL,
    // A shared storage operation can reserve a connection and query through the pool.
    max: readPoolSetting('DATABASE_POOL_MAX', 10, 2, 100),
    idleTimeout: readPoolSetting(
        'DATABASE_POOL_IDLE_TIMEOUT_SECONDS',
        30,
        1,
        maxPoolTimeoutSeconds,
    ),
    maxLifetime: readPoolSetting(
        'DATABASE_POOL_MAX_LIFETIME_SECONDS',
        1_800,
        1,
        maxPoolTimeoutSeconds,
    ),
    connectionTimeout: readPoolSetting(
        'DATABASE_POOL_CONNECTION_TIMEOUT_SECONDS',
        10,
        1,
        maxPoolTimeoutSeconds,
    ),
    connection: {
        application_name: `${PROJECT_CONFIG.packageName}-${getDatabaseApplicationRole()}`,
    },
})
export const db = drizzle(client, { schema })

let closing: Promise<void> | undefined

export function closeDatabaseConnection(): Promise<void> {
    closing ??= client.close({ timeout: 5 })
    return closing
}

globalThis.appDatabaseConnection = { close: closeDatabaseConnection }
