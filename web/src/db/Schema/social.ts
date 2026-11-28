import { sql } from 'drizzle-orm'
import {
    check,
    index,
    primaryKey,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'
import { users } from './users.ts'

/** Open follow graph: one row per follower and followed account. */
export const user_follows = appSchema.table(
    'user_follows',
    {
        followerId: uuid('followerId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        followingId: uuid('followingId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            primaryKey({ columns: [table.followerId, table.followingId] }),
            check(
                'user_follows_no_self_follow_check',
                sql`${table.followerId} <> ${table.followingId}`,
            ),
            index('user_follows_following_created_idx').on(
                table.followingId,
                table.createdAt,
            ),
            index('user_follows_follower_created_idx').on(
                table.followerId,
                table.createdAt,
            ),
        ]
    },
)

/** GitHub-style stars: one row per account and starred app. */
export const app_stars = appSchema.table(
    'app_stars',
    {
        userId: uuid('userId')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        appId: varchar('appId', { length: 97 }).notNull(),
        createdAt: timestamp('createdAt', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
    },
    function (table) {
        return [
            primaryKey({ columns: [table.userId, table.appId] }),
            index('app_stars_app_idx').on(table.appId),
        ]
    },
)
