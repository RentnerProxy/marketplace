import { z } from 'zod'
import { BACKUP_RESTORE_JOURNAL } from '@/config/backup.config.ts'
import type { RestoreJournalBinding } from './Types/restore-journal.types.ts'

const canonicalUuid = z.uuid().refine((value) => value === value.toLowerCase())
const checksumSchema = z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/)
const bindingSchema = z
    .object({
        restoreRunId: canonicalUuid,
        actorUserId: canonicalUuid,
        sourceBackupId: canonicalUuid,
        sourceChecksumSha256: checksumSchema,
        includesStorage: z.boolean(),
    })
    .strict()

export const restoreJournalRecordSchema = bindingSchema
    .extend({
        version: z.literal(BACKUP_RESTORE_JOURNAL.version),
        purpose: z.literal(BACKUP_RESTORE_JOURNAL.purpose),
        algorithm: z.literal('hmac-sha256'),
        sequence: z.number().int().min(1).max(BACKUP_RESTORE_JOURNAL.maxEvents),
        event: z.enum([
            'started',
            'rewind-ready',
            'applied',
            'completed',
            'failed',
            'recovery-required',
        ]),
        occurredAt: z.iso.datetime({ precision: 3 }),
        previousHmacSha256: checksumSchema,
        hmacSha256: checksumSchema,
    })
    .strict()

export function parseRestoreJournalBinding(
    input: unknown,
): RestoreJournalBinding {
    const parsed = bindingSchema.safeParse(input)
    if (!parsed.success)
        throw new Error(
            'Der Restore-Journalnachweis ist ungültig oder beschädigt.',
        )
    return parsed.data
}
