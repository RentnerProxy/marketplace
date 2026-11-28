import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
    independentlySignRecord,
    JOURNAL_BINDING,
    restoreJournalRecordSchema,
    SYNTHETIC_JOURNAL_KEY,
} from './restore-journal.test.helpers.ts'

const state = { root: '' }
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: () => SYNTHETIC_JOURNAL_KEY,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths: () => ({
        backupDirectory: path.join(state.root, 'backup'),
        storageDirectory: path.join(state.root, 'storage'),
    }),
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo: vi.fn(),
    logError: vi.fn(),
}))
const { createRestoreJournalService } =
    await import('@/server/Admin/Backups/restore-journal.service.ts')
let journals: Array<Awaited<ReturnType<typeof createRestoreJournalService>>> =
    []
const filePath = () =>
    path.join(
        state.root,
        'backup/.restore-journal-v1',
        JOURNAL_BINDING.restoreRunId + '.jsonl',
    )

beforeEach(async () => {
    state.root = await mkdtemp(path.join(os.tmpdir(), 'native-journal-test-'))
    journals = []
})
afterEach(async () => {
    await Promise.all(
        journals.map((journal) => journal.close().catch(() => undefined)),
    )
    const root = path.resolve(state.root)
    if (
        path.dirname(root) !== path.resolve(os.tmpdir()) ||
        !path.basename(root).startsWith('native-journal-test-')
    )
        throw new Error('Unsicheres Testverzeichnis.')
    await rm(root, { recursive: true, force: true })
})
async function createJournal() {
    const journal = await createRestoreJournalService(JOURNAL_BINDING)
    journals.push(journal)
    return journal
}

describe('native retained restore journal session', () => {
    test('produces canonical independently authenticated durable records', async () => {
        const journal = await createJournal()
        const ready = journal.append('rewind-ready')
        const applied = journal.append('applied')
        const completed = journal.append('completed')
        await Promise.all([ready, applied, completed])
        await journal.append('recovery-required')
        await journal.close()
        const text = await readFile(filePath(), 'utf8')
        expect(text.endsWith('\n')).toBe(true)
        const records = text
            .slice(0, -1)
            .split('\n')
            .map((line) => restoreJournalRecordSchema.parse(JSON.parse(line)))
        expect(records.map((record) => record.event)).toEqual([
            'started',
            'rewind-ready',
            'applied',
            'completed',
            'recovery-required',
        ])
        for (const [index, record] of records.entries()) {
            expect(record).toMatchObject(JOURNAL_BINDING)
            expect(record.sequence).toBe(index + 1)
            expect(record.previousHmacSha256).toBe(
                records[index - 1]?.hmacSha256 ?? '0'.repeat(64),
            )
            expect(record.hmacSha256).toBe(independentlySignRecord(record))
            expect(new Date(record.occurredAt).toISOString()).toBe(
                record.occurredAt,
            )
        }
    })

    test('rejects authenticated same-inode content replacement before the next append', async () => {
        const journal = await createJournal()
        const original = await readFile(filePath())
        const fixture = z
            .object({ contentBase64: z.string() })
            .passthrough()
            .parse(
                JSON.parse(
                    await readFile(
                        'core/tests/fixtures/restore-journal-v1.json',
                        'utf8',
                    ),
                ),
            )
        const replacement =
            Buffer.from(fixture.contentBase64, 'base64')
                .toString('utf8')
                .split('\n')[0] + '\n'
        await writeFile(filePath(), replacement)
        expect(await readFile(filePath())).not.toEqual(original)
        await expect(journal.append('rewind-ready')).rejects.toThrow()
        await expect(journal.close()).rejects.toThrow()
    })
})
