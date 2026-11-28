import {
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const twoFactorAuth = appSchema.table(
    'two_factor_auth',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        secret: text('secret').notNull(),

        verified: boolean('verified').default(false).notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            uniqueIndex('two_factor_auth_user_id_unique_idx').on(table.userId),
        ]
    },
)

export const trustedDevices = appSchema.table(
    'trusted_devices',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        deviceTokenHash: varchar('deviceTokenHash', { length: 64 })
            .notNull()
            .unique(),

        ip: varchar('ip', { length: 45 }),
        location: varchar('location', { length: 255 }),
        device: varchar('device', { length: 255 }),
        browser: varchar('browser', { length: 255 }),

        expiresAt: timestamp('expiresAt', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),

        lastUsedAt: timestamp('lastUsedAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            index('trusted_devices_user_id_idx').on(table.userId),
            index('trusted_devices_expires_at_idx').on(table.expiresAt),
        ]
    },
)

export const passwordResetTokens = appSchema.table(
    'password_reset_tokens',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        tokenHash: varchar('tokenHash', { length: 64 }).notNull().unique(),

        expiresAt: timestamp('expiresAt', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
    },
    function (table) {
        return [
            index('password_reset_tokens_user_id_idx').on(table.userId),
            index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
        ]
    },
)

export const passkeyCredentials = appSchema.table(
    'passkey_credentials',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        credentialId: text('credentialId').notNull(),
        publicKey: text('publicKey').notNull(),
        webauthnUserId: text('webauthnUserId').notNull(),
        counter: integer('counter').default(0).notNull(),
        transports: jsonb('transports')
            .$type<Array<string>>()
            .default([])
            .notNull(),
        deviceType: varchar('deviceType', { length: 32 }).notNull(),
        backedUp: boolean('backedUp').default(false).notNull(),
        name: varchar('name', { length: 100 }).notNull(),

        lastUsedAt: timestamp('lastUsedAt', {
            withTimezone: true,
            mode: 'date',
        }),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            uniqueIndex('passkey_credentials_credential_id_unique_idx').on(
                table.credentialId,
            ),
            index('passkey_credentials_user_id_idx').on(table.userId),
        ]
    },
)

export const passkeyChallenges = appSchema.table(
    'passkey_challenges',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        userId: uuid('userId').references(() => users.id, {
            onDelete: 'cascade',
        }),

        identifier: varchar('identifier', { length: 255 }),
        webauthnUserId: text('webauthnUserId'),
        challenge: text('challenge').notNull(),
        type: varchar('type', { length: 32 }).notNull(),

        expiresAt: timestamp('expiresAt', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            index('passkey_challenges_user_id_idx').on(table.userId),
            index('passkey_challenges_expires_at_idx').on(table.expiresAt),
            index('passkey_challenges_type_idx').on(table.type),
        ]
    },
)

export const sessions = appSchema.table(
    'sessions',
    {
        id: varchar('id', { length: 255 }).primaryKey(),

        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        ip: varchar('ip', { length: 45 }),
        location: varchar('location', { length: 255 }),
        device: varchar('device', { length: 255 }),
        browser: varchar('browser', { length: 255 }),

        expiresAt: timestamp('expiresAt', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
    },
    function (table) {
        return [
            index('sessions_user_id_expires_at_idx').on(
                table.userId,
                table.expiresAt,
            ),
            index('sessions_expires_at_idx').on(table.expiresAt),
        ]
    },
)
