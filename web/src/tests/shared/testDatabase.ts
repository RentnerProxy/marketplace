import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from '@/db/schema.ts'

const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
    throw new Error(
        'Das DB-Test-Setup muss DATABASE_URL vor dem Import des Testtreibers setzen.',
    )
}

const client = new SQL(databaseUrl, {
    max: 4,
})
let closePromise: Promise<void> | undefined

export const db = drizzle(client, { schema })

export function closeTestDatabase() {
    closePromise ??= client.close()
    return closePromise
}
