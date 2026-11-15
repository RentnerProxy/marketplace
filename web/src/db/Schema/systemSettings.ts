import { boolean, timestamp, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from './base.ts'

export const systemSettings = appSchema.table('system_settings', {
    id: varchar('id', { length: 50 }).primaryKey(),

    companyName: varchar('companyName', { length: 100 }).notNull(),

    logoUpdatedAt: timestamp('logoUpdatedAt', {
        withTimezone: true,
        mode: 'date',
    }),

    isMaintenanceModeEnabled: boolean('isMaintenanceModeEnabled')
        .default(false)
        .notNull(),

    maintenanceStartsAt: timestamp('maintenanceStartsAt', {
        withTimezone: true,
        mode: 'date',
    }),

    updatedAt: timestamp('updatedAt', {
        withTimezone: true,
        mode: 'date',
    })
        .defaultNow()
        .notNull(),
})
