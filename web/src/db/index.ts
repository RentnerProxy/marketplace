import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import * as schema from './schema.ts'

const databaseUrl = process.env.DATABASE_URL
const client = databaseUrl === undefined ? new SQL() : new SQL(databaseUrl)
export const db = drizzle(client, { schema })
