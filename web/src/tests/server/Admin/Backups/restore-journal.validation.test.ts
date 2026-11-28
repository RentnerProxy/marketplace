import { describe, expect, test } from 'bun:test'
import { parseRestoreJournalBinding } from '@/server/Admin/Backups/restore-journal.validation.ts'
import { JOURNAL_BINDING } from './restore-journal.test.helpers.ts'

describe('restore journal boundary shapes', () => {
    test('requires canonical UUIDs, checksums and exact binding fields', () => {
        expect(parseRestoreJournalBinding(JOURNAL_BINDING)).toEqual(
            JOURNAL_BINDING,
        )
        for (const invalid of [
            {
                ...JOURNAL_BINDING,
                actorUserId: JOURNAL_BINDING.actorUserId.toUpperCase(),
            },
            {
                ...JOURNAL_BINDING,
                restoreRunId: JOURNAL_BINDING.restoreRunId + '\n',
            },
            { ...JOURNAL_BINDING, sourceChecksumSha256: 'b'.repeat(64) + '\n' },
            { ...JOURNAL_BINDING, sourceChecksumSha256: 'B'.repeat(64) },
            { ...JOURNAL_BINDING, sessionHash: 'must-not-enter-evidence' },
        ])
            expect(() => parseRestoreJournalBinding(invalid)).toThrow()
    })
})
