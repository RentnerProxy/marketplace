import { z } from 'zod'
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
