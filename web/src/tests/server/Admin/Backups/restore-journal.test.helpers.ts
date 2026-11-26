import { createHmac, hkdfSync } from 'node:crypto'
import { z } from 'zod'

const canonicalUuid = z.uuid().refine((value) => value === value.toLowerCase())
const checksum = z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/)

export const restoreJournalRecordSchema = z.strictObject({
    restoreRunId: canonicalUuid,
    actorUserId: canonicalUuid,
    sourceBackupId: canonicalUuid,
    sourceChecksumSha256: checksum,
    includesStorage: z.boolean(),
    version: z.literal(1),
    purpose: z.literal('restore-journal-v1'),
    algorithm: z.literal('hmac-sha256'),
    sequence: z.number().int().min(1).max(8),
    event: z.enum([
        'started',
        'rewind-ready',
        'applied',
        'completed',
        'failed',
        'recovery-required',
    ]),
    occurredAt: z.iso.datetime({ precision: 3 }),
    previousHmacSha256: checksum,
    hmacSha256: checksum,
})

export const SYNTHETIC_JOURNAL_KEY = Buffer.alloc(32, 19).toString('base64')
export const JOURNAL_BINDING = {
    restoreRunId: 'c19d5271-40d5-46c1-8489-3004f95258ba',
    actorUserId: '8541b5ba-e72a-43be-84b2-f21270b26f76',
    sourceBackupId: '5e251056-9a71-4f3c-9730-6b0387998381',
    sourceChecksumSha256: 'b'.repeat(64),
    includesStorage: true,
}
export function deriveSyntheticJournalKey() {
    return Buffer.from(
        hkdfSync(
            'sha256',
            Buffer.from(SYNTHETIC_JOURNAL_KEY, 'base64'),
            'tanstack-restore-journal-key-v1',
            'restore-journal-integrity-v1',
            32,
        ),
    )
}
export function independentlySignRecord(
    record: z.infer<typeof restoreJournalRecordSchema>,
) {
    return createHmac('sha256', deriveSyntheticJournalKey())
        .update(
            JSON.stringify([
                record.purpose,
                record.version,
                record.algorithm,
                record.restoreRunId,
                record.actorUserId,
                record.sourceBackupId,
                record.sourceChecksumSha256,
                record.includesStorage,
                record.sequence,
                record.event,
                record.occurredAt,
                record.previousHmacSha256,
            ]),
        )
        .digest('hex')
}
