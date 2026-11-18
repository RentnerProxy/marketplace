import { afterAll, beforeAll, test, vi } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/db/schema.ts'

const client = new PGlite()
const db = drizzle(client, { schema })
vi.mock('@/db', () => ({ db }))

const { exerciseSubmissionLifecycle } =
    await import('./submission-lifecycle.fixture.ts')

beforeAll(async () => {
    await migrate(db, { migrationsFolder: './web/drizzle' })
})

afterAll(async () => {
    await client.close()
})

test(
    'recovers candidate validation and authorizes exact publication on a migrated PostgreSQL schema',
    exerciseSubmissionLifecycle,
)
