import { createHmac, hkdfSync } from 'node:crypto'
import type { RestoreJournalRecord } from '@/server/Admin/Backups/Types/restore-journal.types.ts'

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
export function independentlySignRecord(record: RestoreJournalRecord) {
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
