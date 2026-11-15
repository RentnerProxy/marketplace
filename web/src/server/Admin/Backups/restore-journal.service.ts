import { z } from 'zod'
import { BACKUP_RESTORE_JOURNAL } from '@/config/backup.config.ts'
import { encryptionKeySchema } from '@/server/Runtime/environment-schema.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { openCoreSessionService } from '@/server/Core/session.service.ts'
import { getBackupStoragePaths } from './backup-directory.service.ts'
import { parseRestoreJournalBinding } from './restore-journal.validation.ts'
import type {
    RestoreJournal,
    RestoreJournalBinding,
} from './Types/restore-journal.types.ts'

const acknowledgementSchema = z.object({ ok: z.literal(true) }).strict()

export async function createRestoreJournalService(
    input: RestoreJournalBinding,
): Promise<RestoreJournal> {
    const binding = parseRestoreJournalBinding(input)
    const parsed = encryptionKeySchema.safeParse(
        getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
    )
    if (!parsed.success)
        throw new Error(
            'Der Schlüssel für den Restore-Journalnachweis ist ungültig.',
        )
    const session = await openCoreSessionService(
        'storage',
        ['journal-session'],
        {
            operation: 'journalStart',
            ...getBackupStoragePaths(),
            binding,
            masterKeyBase64: parsed.data,
        },
        { validateReady: (value) => acknowledgementSchema.parse(value) },
    )
    let accepting = true
    let tail: Promise<void> = Promise.resolve()
    let closePromise: Promise<void> | undefined
    let acceptedEvents = 1
    return {
        append(event) {
            if (!accepting)
                return Promise.reject(
                    new Error(
                        'Der Restore-Journalnachweis ist bereits geschlossen.',
                    ),
                )
            // The native journal permits at most eight events. Bound queued work
            // here too, before serializing requests into the retained session.
            acceptedEvents += 1
            const eventCount = acceptedEvents
            if (eventCount > BACKUP_RESTORE_JOURNAL.maxEvents) {
                accepting = false
                const failure = tail.then(function () {
                    throw new Error(
                        'Der Restore-Journalnachweis ist ungültig oder beschädigt.',
                    )
                })
                tail = failure
                void tail.catch(() => undefined)
                return failure
            }
            const operation = tail.then(async function () {
                await session.request(
                    { operation: 'journalAppend', event },
                    (value) => acknowledgementSchema.parse(value),
                )
                return undefined
            })
            tail = operation
            void tail.catch(() => undefined)
            return operation
        },
        close() {
            if (closePromise) return closePromise
            accepting = false
            closePromise = (async function () {
                try {
                    await tail
                    await session.close(
                        { operation: 'journalClose' },
                        (value) => acknowledgementSchema.parse(value),
                    )
                } catch (error) {
                    await session.abort()
                    throw error
                }
            })()
            void closePromise.catch(() => undefined)
            return closePromise
        },
    }
}
