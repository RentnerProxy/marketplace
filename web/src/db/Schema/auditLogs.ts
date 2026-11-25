import { index, jsonb, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const auditLogs = appSchema.table(
    'audit_logs',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),

        action: varchar('action', { length: 100 }).notNull(),

        actorUserId: uuid('actorUserId').references(() => users.id, {
            onDelete: 'set null',
        }),

        message: varchar('message', { length: 500 }),
        route: varchar('route', { length: 255 }),
        method: varchar('method', { length: 20 }),

        oldValues: jsonb('oldValues').$type<Record<string, unknown> | null>(),

        newValues: jsonb('newValues').$type<Record<string, unknown> | null>(),

        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index('audit_logs_created_at_idx').on(table.createdAt),
        index('audit_logs_actor_user_id_created_at_idx').on(
            table.actorUserId,
            table.createdAt,
        ),
        index('audit_logs_action_created_at_idx').on(
            table.action,
            table.createdAt,
        ),
    ],
)
