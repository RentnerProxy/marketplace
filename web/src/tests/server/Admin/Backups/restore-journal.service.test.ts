/* eslint-disable no-await-in-loop -- Each invalid key uses a distinct shared environment mock. */
import { beforeEach, describe, expect, test, vi } from 'bun:test'
import {
    JOURNAL_BINDING,
    SYNTHETIC_JOURNAL_KEY,
} from './restore-journal.test.helpers.ts'

const mocks = {
    key: SYNTHETIC_JOURNAL_KEY,
    request: vi.fn(
        async (
            _request: Record<string, unknown>,
            validate: (value: unknown) => unknown,
        ) => validate({ ok: true }),
    ),
    close: vi.fn(
        async (
            _request: Record<string, unknown>,
            validate: (value: unknown) => unknown,
        ) => {
            validate({ ok: true })
        },
    ),
    abort: vi.fn(async () => {}),
    open: vi.fn(),
    roots: vi.fn(() => ({
        backupDirectory: 'synthetic-backup',
        storageDirectory: 'synthetic-storage',
    })),
}
vi.mock('@/server/Core/session.service.ts', () => ({
    openCoreSessionService: mocks.open,
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: () => mocks.key,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths: mocks.roots,
}))
const { createRestoreJournalService } =
    await import('@/server/Admin/Backups/restore-journal.service.ts')

beforeEach(() => {
    mocks.key = SYNTHETIC_JOURNAL_KEY
    mocks.request
        .mockReset()
        .mockImplementation(async (_request, validate) =>
            validate({ ok: true }),
        )
    mocks.close.mockReset().mockImplementation(async (_request, validate) => {
        validate({ ok: true })
    })
    mocks.abort.mockClear()
    mocks.roots.mockClear()
    mocks.open
        .mockReset()
        .mockImplementation(async (_binary, _args, _request, options) => {
            options.validateReady({ ok: true })
            return {
                request: mocks.request,
                close: mocks.close,
                abort: mocks.abort,
            }
        })
})

describe('restore journal native session adapter', () => {
    test('validates bindings and key before acquiring native resources', async () => {
        await Promise.all(
            [
                { ...JOURNAL_BINDING, restoreRunId: '../outside' },
                {
                    ...JOURNAL_BINDING,
                    actorUserId: JOURNAL_BINDING.actorUserId.toUpperCase(),
                },
            ].map((binding) =>
                expect(createRestoreJournalService(binding)).rejects.toThrow(),
            ),
        )
        for (const key of [
            '',
            'invalid',
            Buffer.alloc(31).toString('base64'),
            Buffer.alloc(33).toString('base64'),
        ]) {
            mocks.key = key
            const pending = expect(
                createRestoreJournalService(JOURNAL_BINDING),
            ).rejects.toThrow()
            await pending
        }
        expect(mocks.open).not.toHaveBeenCalled()
        expect(mocks.roots).not.toHaveBeenCalled()
    })

    test('awaits the started durability acknowledgement before exposing the journal', async () => {
        const gate = Promise.withResolvers<void>()
        mocks.open.mockImplementationOnce(
            async (_binary, _args, _request, options) => {
                await gate.promise
                options.validateReady({ ok: true })
                return {
                    request: mocks.request,
                    close: mocks.close,
                    abort: mocks.abort,
                }
            },
        )
        let resolved = false
        const pending = createRestoreJournalService(JOURNAL_BINDING).then(
            (journal) => {
                resolved = true
                return journal
            },
        )
        await Promise.resolve()
        expect(resolved).toBe(false)
        gate.resolve()
        const journal = await pending
        expect(mocks.open.mock.calls[0]?.slice(0, 3)).toEqual([
            'storage',
            ['journal-session'],
            {
                operation: 'journalStart',
                backupDirectory: 'synthetic-backup',
                storageDirectory: 'synthetic-storage',
                binding: JOURNAL_BINDING,
                masterKeyBase64: SYNTHETIC_JOURNAL_KEY,
            },
        ])
        await journal.close()
    })

    test('serializes appends, drains accepted operations and closes exactly once', async () => {
        const journal = await createRestoreJournalService(JOURNAL_BINDING)
        const gate = Promise.withResolvers<void>()
        mocks.request.mockImplementationOnce(async (_request, validate) => {
            await gate.promise
            return validate({ ok: true })
        })
        const first = journal.append('rewind-ready')
        const second = journal.append('applied')
        const closing = journal.close()
        expect(journal.close()).toBe(closing)
        await expect(journal.append('completed')).rejects.toThrow('geschlossen')
        await Promise.resolve()
        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.close).not.toHaveBeenCalled()
        gate.resolve()
        await Promise.all([first, second, closing])
        expect(mocks.request.mock.calls.map(([request]) => request)).toEqual([
            { operation: 'journalAppend', event: 'rewind-ready' },
            { operation: 'journalAppend', event: 'applied' },
        ])
        expect(mocks.close).toHaveBeenCalledTimes(1)
        expect(mocks.abort).not.toHaveBeenCalled()
    })

    test('poisons all queued and later appends after a failure and tears down on close', async () => {
        const failure = new Error('synthetic fsync failure')
        const journal = await createRestoreJournalService(JOURNAL_BINDING)
        mocks.request.mockRejectedValueOnce(failure)
        const first = journal.append('rewind-ready')
        const second = journal.append('applied')
        await expect(first).rejects.toBe(failure)
        await expect(second).rejects.toBe(failure)
        await expect(journal.append('failed')).rejects.toBe(failure)
        const closing = journal.close()
        expect(journal.close()).toBe(closing)
        await expect(closing).rejects.toBe(failure)
        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.close).not.toHaveBeenCalled()
        expect(mocks.abort).toHaveBeenCalledTimes(1)
    })

    test('rejects malformed acknowledgements and reports close failures idempotently', async () => {
        const journal = await createRestoreJournalService(JOURNAL_BINDING)
        mocks.close.mockImplementationOnce(async (_request, validate) => {
            validate({ ok: false })
        })
        const closing = journal.close()
        await expect(closing).rejects.toThrow()
        expect(journal.close()).toBe(closing)
        expect(mocks.abort).toHaveBeenCalledTimes(1)
    })

    test('bounds accepted queued events before entering the native transport', async () => {
        const journal = await createRestoreJournalService(JOURNAL_BINDING)
        const accepted = Array.from({ length: 7 }, () =>
            journal.append('recovery-required'),
        )
        const rejected = journal.append('failed')
        await Promise.all(accepted)
        await expect(rejected).rejects.toThrow()
        await expect(journal.append('completed')).rejects.toThrow('geschlossen')
        await expect(journal.close()).rejects.toThrow()
        expect(mocks.request).toHaveBeenCalledTimes(7)
        expect(mocks.abort).toHaveBeenCalledTimes(1)
    })
})
