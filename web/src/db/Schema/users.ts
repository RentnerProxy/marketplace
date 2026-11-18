import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    integer,
    text,
    timestamp,
    uuid,
    varchar,
    index,
    unique,
    uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'

export const users = appSchema.table(
    'users',
    {
        id: uuid('id')
            .$defaultFn(function () {
                return Bun.randomUUIDv7()
            })
            .primaryKey(),

        username: varchar('username', { length: 50 }).notNull(),
        email: varchar('email', { length: 255 }).notNull(),

        passwordHash: text('passwordHash').notNull(),
        emailVerifiedAt: timestamp('emailVerifiedAt', {
            withTimezone: true,
            mode: 'date',
        }),
        accountType: varchar('accountType', { length: 6 })
            .$type<AccountType>()
            .notNull(),

        isTwoFactorEnabled: boolean('isTwoFactorEnabled')
            .default(false)
            .notNull(),
        isActive: boolean('isActive').default(true).notNull(),
        isDeleted: boolean('isDeleted').default(false).notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            uniqueIndex('users_username_active_unique_idx')
                .on(table.username)
                .where(sql`${table.isDeleted} = false`),
            uniqueIndex('users_email_active_unique_idx')
                .on(table.email)
                .where(sql`${table.isDeleted} = false`),
            check(
                'users_account_type_check',
                sql`${table.accountType} in ('public', 'staff')`,
            ),
            unique('users_id_account_type_unique').on(
                table.id,
                table.accountType,
            ),
            index('users_account_type_idx').on(table.accountType),
            index('users_is_deleted_idx').on(table.isDeleted),
        ]
    },
)

export const user_profiles = appSchema.table('user_profiles', {
    userId: uuid('userId')
        .primaryKey()
        .references(
            function (): AnyPgColumn {
                return users.id
            },
            {
                onDelete: 'cascade',
            },
        ),

    firstName: varchar('firstName', { length: 100 }),
    lastName: varchar('lastName', { length: 100 }),

    street: varchar('street', { length: 100 }),
    houseNumber: varchar('houseNumber', { length: 20 }),
    postalCode: varchar('postalCode', { length: 20 }),
    city: varchar('city', { length: 100 }),
    profileImageUpdatedAt: timestamp('profileImageUpdatedAt', {
        withTimezone: true,
        mode: 'date',
    }),
})

export const notifications = appSchema.table(
    'notifications',
    {
        id: uuid('id')
            .$defaultFn(function () {
                return Bun.randomUUIDv7()
            })
            .primaryKey(),

        userId: uuid('userId').references(() => users.id, {
            onDelete: 'cascade',
        }),

        title: varchar('title', { length: 255 }).notNull(),
        message: text('message').notNull(),
        type: varchar('type', { length: 50 }).default('info').notNull(),
        referenceId: uuid('referenceId'),

        isRead: boolean('isRead').default(false).notNull(),

        readAt: timestamp('readAt', {
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
            index('notifications_user_id_idx').on(table.userId),
            index('notifications_is_read_idx').on(table.isRead),
            index('notifications_reference_id_idx').on(table.referenceId),
        ]
    },
)

export const user_settings = appSchema.table(
    'user_settings',
    {
        userId: uuid('userId')
            .primaryKey()
            .references(
                function (): AnyPgColumn {
                    return users.id
                },
                {
                    onDelete: 'cascade',
                },
            ),

        primaryColor: varchar('primaryColor', { length: 20 }),
        themeMode: varchar('themeMode', { length: 20 })
            .default('dark')
            .notNull(),
        fontFamily: varchar('fontFamily', { length: 20 })
            .default('inter')
            .notNull(),
        fontSize: integer('fontSize').default(16).notNull(),

        customBackgroundUpdatedAt: timestamp('customBackgroundUpdatedAt', {
            withTimezone: true,
            mode: 'date',
        }),
        customBackgroundDarkness: integer('customBackgroundDarkness'),
    },
    function (table) {
        return [
            check(
                'user_settings_theme_mode_check',
                sql`${table.themeMode} in ('dark', 'light')`,
            ),
            check(
                'user_settings_font_family_check',
                sql`${table.fontFamily} in ('inter', 'system', 'serif', 'mono')`,
            ),
            check(
                'user_settings_font_size_check',
                sql`${table.fontSize} in (14, 15, 16, 17, 18)`,
            ),
            check(
                'user_settings_custom_background_darkness_check',
                sql`${table.customBackgroundDarkness} is null or (${table.customBackgroundDarkness} >= 0 and ${table.customBackgroundDarkness} <= 100)`,
            ),
        ]
    },
)
