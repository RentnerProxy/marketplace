import { index, integer, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

/** Web-editable store listing of an app; independent of released versions. */
export const app_store_entries = appSchema.table('app_store_entries', {
    appId: varchar('appId', { length: 97 }).primaryKey(),
    description: varchar('description', { length: 5000 }),
    /** File id of the current logo: /images/apps/<appId>/<logoFileId>.webp */
    logoFileId: uuid('logoFileId'),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .notNull(),
    updatedBy: uuid('updatedBy').references(() => users.id, {
        onDelete: 'set null',
    }),
})

/** Ordered screenshot gallery; the row id is also the image file id. */
export const app_store_screenshots = appSchema.table(
    'app_store_screenshots',
    {
        id: uuid('id').primaryKey(),
        appId: varchar('appId', { length: 97 })
            .notNull()
            .references(() => app_store_entries.appId, { onDelete: 'cascade' }),
        position: integer('position').notNull(),
        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            index('app_store_screenshots_app_position_idx').on(
                table.appId,
                table.position,
            ),
        ]
    },
)
