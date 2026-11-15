import { primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const permissions = appSchema.table('permissions', {
    id: uuid('id')
        .$defaultFn(() => Bun.randomUUIDv7())
        .primaryKey(),

    key: varchar('key', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description').notNull(),

    createdAt: timestamp('createdAt', {
        withTimezone: true,
        mode: 'date',
    })
        .defaultNow()
        .notNull(),
})

export const userPermissions = appSchema.table(
    'user_permissions',
    {
        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

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

export const defaultUserPermissions = appSchema.table(
    'default_user_permissions',
    {
        permissionId: uuid('permissionId')
            .primaryKey()
            .references(() => permissions.id, { onDelete: 'cascade' }),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
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
