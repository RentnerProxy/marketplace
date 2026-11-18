import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    foreignKey,
    index,
    jsonb,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const publicAccounts = appSchema.table(
    'public_accounts',
    {
        userId: uuid('userId').primaryKey(),
        accountType: varchar('accountType', { length: 6 })
            .$type<'public'>()
            .default('public')
            .notNull(),
    },
    (table) => [
        check(
            'public_accounts_type_check',
            sql`${table.accountType} = 'public'`,
        ),
        foreignKey({
            name: 'public_account_identity_fk',
            columns: [table.userId, table.accountType],
            foreignColumns: [users.id, users.accountType],
        }).onDelete('cascade'),
    ],
)

export const staffAccounts = appSchema.table(
    'staff_accounts',
    {
        userId: uuid('userId').primaryKey(),
        accountType: varchar('accountType', { length: 6 })
            .$type<'staff'>()
            .default('staff')
            .notNull(),
        invitedByUserId: uuid('invitedByUserId').references(
            (): AnyPgColumn => staffAccounts.userId,
            { onDelete: 'set null' },
        ),
    },
    (table) => [
        check('staff_accounts_type_check', sql`${table.accountType} = 'staff'`),
        foreignKey({
            name: 'staff_account_identity_fk',
            columns: [table.userId, table.accountType],
            foreignColumns: [users.id, users.accountType],
        }).onDelete('cascade'),
        index('staff_accounts_invited_by_idx').on(table.invitedByUserId),
    ],
)

export const staffInvitations = appSchema.table(
    'staff_invitations',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),
        email: varchar('email', { length: 255 }).notNull(),
        username: varchar('username', { length: 50 }).notNull(),
        tokenHash: varchar('tokenHash', { length: 64 }).notNull().unique(),
        expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
        isActive: boolean('isActive').default(true).notNull(),
        invitedByUserId: uuid('invitedByUserId').references(
            () => staffAccounts.userId,
            { onDelete: 'set null' },
        ),
        permissionKeys: jsonb('permissionKeys')
            .$type<Array<string>>()
            .notNull(),
    },
    (table) => [
        uniqueIndex('staff_invitations_email_unique').on(
            sql`lower(${table.email})`,
        ),
        uniqueIndex('staff_invitations_username_unique').on(
            sql`lower(${table.username})`,
        ),
        index('staff_invitations_expires_at_idx').on(table.expiresAt),
        index('staff_invitations_invited_by_idx').on(table.invitedByUserId),
    ],
)
