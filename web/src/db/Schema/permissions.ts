import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    foreignKey,
    primaryKey,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { publicAccounts, staffAccounts } from './accounts.ts'

export const permissions = appSchema.table(
    'permissions',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        key: varchar('key', { length: 100 }).notNull().unique(),
        name: varchar('name', { length: 100 }).notNull(),
        description: text('description').notNull(),
        publicEligible: boolean('publicEligible')
            .generatedAlwaysAs(sql`"key" like 'user.%'`)
            .notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        unique('permissions_id_public_eligible_unique').on(
            table.id,
            table.publicEligible,
        ),
    ],
)

export const staffUserPermissions = appSchema.table(
    'staff_user_permissions',
    {
        userId: uuid('userId')
            .notNull()
            .references(() => staffAccounts.userId, { onDelete: 'cascade' }),

        permissionId: uuid('permissionId')
            .notNull()
            .references(() => permissions.id, { onDelete: 'cascade' }),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    (table) => [primaryKey({ columns: [table.userId, table.permissionId] })],
)

export const publicUserPermissions = appSchema.table(
    'public_user_permissions',
    {
        userId: uuid('userId')
            .notNull()
            .references(() => publicAccounts.userId, { onDelete: 'cascade' }),
        permissionId: uuid('permissionId').notNull(),
        publicEligible: boolean('publicEligible').default(true).notNull(),
        createdAt: timestamp('createdAt', { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.userId, table.permissionId] }),
        check(
            'public_user_permissions_scope_check',
            sql`${table.publicEligible}`,
        ),
        foreignKey({
            name: 'public_user_permission_fk',
            columns: [table.permissionId, table.publicEligible],
            foreignColumns: [permissions.id, permissions.publicEligible],
        }).onDelete('cascade'),
    ],
)

export const accountPermissions = appSchema.view('account_permissions', {
    userId: uuid('userId').notNull(),
    permissionId: uuid('permissionId').notNull(),
}).as(sql`
    select "userId", "permissionId" from ${publicUserPermissions}
    union all
    select "userId", "permissionId" from ${staffUserPermissions}
`)

export const defaultUserPermissions = appSchema.table(
    'default_user_permissions',
    {
        permissionId: uuid('permissionId').primaryKey(),
        publicEligible: boolean('publicEligible').default(true).notNull(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        check(
            'default_user_permissions_scope_check',
            sql`${table.publicEligible}`,
        ),
        foreignKey({
            name: 'public_default_permission_fk',
            columns: [table.permissionId, table.publicEligible],
            foreignColumns: [permissions.id, permissions.publicEligible],
        }).onDelete('cascade'),
    ],
)

export const permissionPresets = appSchema.table('permission_presets', {
    id: uuid('id')
        .$defaultFn(() => Bun.randomUUIDv7())
        .primaryKey(),

    name: varchar('name', { length: 100 }).notNull().unique(),
    description: text('description').notNull(),

    createdAt: timestamp('createdAt', {
        withTimezone: true,
        mode: 'date',
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updatedAt', {
        withTimezone: true,
        mode: 'date',
    })
        .defaultNow()
        .notNull(),
})

export const permissionPresetPermissions = appSchema.table(
    'permission_preset_permissions',
    {
        presetId: uuid('presetId')
            .notNull()
            .references(() => permissionPresets.id, { onDelete: 'cascade' }),

        permissionId: uuid('permissionId')
            .notNull()
            .references(() => permissions.id, { onDelete: 'cascade' }),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    (table) => [primaryKey({ columns: [table.presetId, table.permissionId] })],
)
