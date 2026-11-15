import { z } from 'zod'
import { CONTAINER_LOGS, RUNTIME_LOGS } from '@/config/logging.config.ts'
import { runtimeLogEntrySchema } from './runtime-log.validation.ts'

export const containerLogReaderOriginSchema = z
    .string()
    .trim()
    .refine(function (value) {
        try {
            const url = new URL(value)
            return (
                ['http:', 'https:'].includes(url.protocol) &&
                url.origin === value &&
                !url.username &&
                !url.password
            )
        } catch {
            return false
        }
    }, 'CONTAINER_LOG_READER_URL muss eine http(s)-Origin ohne Pfad oder Zugangsdaten sein.')

export const containerLogSnapshotSchema = z
    .object({
        source: z.literal('container'),
        sharedHistoryAvailable: z.literal(true),
        entries: z
            .array(
                runtimeLogEntrySchema.extend({
                    id: z.string().regex(/^[a-f0-9]{64}$/),
                    message: z.string().max(CONTAINER_LOGS.maxLineLength + 1),
                }),
            )
            .max(RUNTIME_LOGS.maxEntries),
    })
    .strict()
