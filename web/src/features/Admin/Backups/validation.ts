import { z } from 'zod'

export const backupApiErrorResponseSchema = z.object({
    error: z.string().optional(),
})
export const backupImportResponseSchema = backupApiErrorResponseSchema.extend({
    success: z.boolean(),
})
export const queuedBackupCreationResponseSchema = z.object({
    success: z.literal(true),
    backupId: z.uuidv7(),
})

export const updateBackupSettingsInputSchema = z.object({
    isEnabled: z.boolean(),
    scheduleType: z.enum([
        'daily',
        'weekdays',
        'interval-hours',
        'interval-weeks',
    ]),
    scheduleInterval: z.number().int().min(1).max(168),
    scheduleWeekdays: z
        .string()
        .regex(/^[0-6](,[0-6])*$/)
        .refine(
            (value) =>
                new Set(value.split(',')).size === value.split(',').length,
        ),
    scheduleHour: z.number().int().min(0).max(23),
    scheduleMinute: z.number().int().min(0).max(59),
    retentionMode: z.enum(['days', 'count', 'both']),
    retentionDays: z.number().int().min(1).max(3650),
    retentionCount: z.number().int().min(1).max(1000),
    includeStorage: z.boolean(),
})

export const backupIdInputSchema = z.object({
    backupId: z.uuidv7(),
})

export const backupCreationProgressInputSchema = z
    .object({
        runId: z.uuidv7().optional(),
    })
    .strict()

export const restoreBackupInputSchema = backupIdInputSchema.extend({
    confirmation: z.literal('WIEDERHERSTELLEN'),
})
