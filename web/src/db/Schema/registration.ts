import { index, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export const pendingRegistrations = appSchema.table('pending_registrations', {
    id: uuid('id').$defaultFn(() => Bun.randomUUIDv7()).primaryKey(),
    username: varchar('username', { length: 50 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('passwordHash').notNull(),
    tokenHash: varchar('tokenHash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    termsVersion: varchar('termsVersion', { length: 50 }).notNull(),
    acceptedAt: timestamp('acceptedAt', { withTimezone: true, mode: 'date' }).notNull(),
    provider: varchar('provider', { length: 32 }).$type<SocialProviderId>(),
    subject: varchar('subject', { length: 255 }),
}, (table) => [index('pending_registrations_expires_at_idx').on(table.expiresAt)])
