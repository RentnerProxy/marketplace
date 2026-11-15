import { z } from 'zod'
import { LOG_LIMITS, RUNTIME_LOGS } from '@/config/logging.config.ts'
import type { RuntimeLogEntry } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'

export const runtimeLogEntrySchema = z
    .object({
        id: z.uuid(),
        timestamp: z.iso.datetime(),
        level: z.enum(['info', 'warn', 'error']),
        event: z
            .string()
            .max(LOG_LIMITS.eventLength)
            .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+){1,8}$/),
        context: z
            .record(
                z.string().max(40),
                z.union([
                    z.string().max(160),
                    z.number().finite(),
                    z.boolean(),
                    z.null(),
                    z.undefined(),
                ]),
            )
            .refine((value) => Object.keys(value).length <= 60),
    })
    .strict() satisfies z.ZodType<RuntimeLogEntry>

export const runtimeLogLinesSchema = z
    .array(z.string().max(RUNTIME_LOGS.maxSerializedEntryLength))
    .max(RUNTIME_LOGS.maxEntries)
