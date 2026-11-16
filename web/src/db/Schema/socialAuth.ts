import { index, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const socialAccounts = appSchema.table('social_accounts', {
    id: uuid('id').$defaultFn(() => Bun.randomUUIDv7()).primaryKey(),
    userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 20 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('social_accounts_provider_subject_unique_idx').on(table.provider, table.subject),
    uniqueIndex('social_accounts_user_provider_unique_idx').on(table.userId, table.provider),
])

export const socialAuthChallenges = appSchema.table('social_auth_challenges', {
    tokenHash: varchar('tokenHash', { length: 64 }).primaryKey(),
    browserHash: varchar('browserHash', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 20 }).notNull(),
    purpose: varchar('purpose', { length: 20 }).notNull(),
    payload: text('payload').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [index('social_auth_challenges_expires_at_idx').on(table.expiresAt)])
