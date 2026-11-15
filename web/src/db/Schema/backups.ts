import {
    bigint,
    boolean,
    check,
    index,
    integer,
    text,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { appSchema } from './base.ts'
import { users } from './users.ts'

export const backupSettings = appSchema.table(
    'backup_settings',
    {
        id: varchar('id', { length: 50 }).primaryKey(),
        isEnabled: boolean('isEnabled').default(false).notNull(),
        targetKey: varchar('targetKey', { length: 50 })
            .default('local')
            .notNull(),
        scheduleType: varchar('scheduleType', { length: 30 })
            .default('daily')
            .notNull(),
        scheduleInterval: integer('scheduleInterval').default(1).notNull(),
        scheduleWeekdays: varchar('scheduleWeekdays', { length: 20 })
            .default('1,2,3,4,5')
            .notNull(),
        scheduleHour: integer('scheduleHour').default(3).notNull(),
        scheduleMinute: integer('scheduleMinute').default(0).notNull(),
        retentionMode: varchar('retentionMode', { length: 20 })
            .default('count')
            .notNull(),
        retentionDays: integer('retentionDays').default(30).notNull(),
        retentionCount: integer('retentionCount').default(10).notNull(),
        includeStorage: boolean('includeStorage').default(true).notNull(),
        updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedByUserId: uuid('updatedByUserId').references(() => users.id, {
            onDelete: 'set null',
        }),
    },
    (table) => [
        check(
            'backup_settings_schedule_type_check',
            sql`${table.scheduleType} in ('daily', 'weekdays', 'interval-hours', 'interval-weeks')`,
        ),
        check(
            'backup_settings_schedule_interval_check',
            sql`${table.scheduleInterval} between 1 and 168`,
        ),
        check(
            'backup_settings_retention_mode_check',
            sql`${table.retentionMode} in ('days', 'count', 'both')`,
        ),
        check(
            'backup_settings_schedule_hour_check',
            sql`${table.scheduleHour} between 0 and 23`,
        ),
        check(
            'backup_settings_schedule_minute_check',
            sql`${table.scheduleMinute} between 0 and 59`,
        ),
        check(
            'backup_settings_retention_days_check',
            sql`${table.retentionDays} between 1 and 3650`,
        ),
        check(
            'backup_settings_retention_count_check',
            sql`${table.retentionCount} between 1 and 1000`,
        ),
    ],
)

export const backupRuns = appSchema.table(
    'backup_runs',
    {
        id: uuid('id')
            .$defaultFn(() => Bun.randomUUIDv7())
            .primaryKey(),
        trigger: varchar('trigger', { length: 20 }).notNull(),
        status: varchar('status', { length: 20 }).notNull(),
        targetKey: varchar('targetKey', { length: 50 }).notNull(),
        fileName: varchar('fileName', { length: 255 }),
        fileSize: bigint('fileSize', { mode: 'number' }),
        checksumSha256: varchar('checksumSha256', { length: 64 }),
        includesStorage: boolean('includesStorage').default(true).notNull(),
        errorMessage: text('errorMessage'),
        startedAt: timestamp('startedAt', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        completedAt: timestamp('completedAt', {
            withTimezone: true,
            mode: 'date',
        }),
        createdByUserId: uuid('createdByUserId').references(() => users.id, {
            onDelete: 'set null',
        }),
    },
    (table) => [
        check(
            'backup_runs_trigger_check',
            sql`${table.trigger} in ('manual', 'scheduled', 'restore-safety', 'import', 'restore')`,
        ),
        check(
            'backup_runs_status_check',
            sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
        ),
        check(
            'backup_runs_file_size_check',
            sql`${table.fileSize} is null or ${table.fileSize} >= 0`,
        ),
        index('backup_runs_started_at_idx').on(table.startedAt),
        index('backup_runs_status_started_at_idx').on(
            table.status,
            table.startedAt,
        ),
        index('backup_runs_target_status_started_at_idx').on(
            table.targetKey,
            table.status,
            table.startedAt,
        ),
    ],
)
