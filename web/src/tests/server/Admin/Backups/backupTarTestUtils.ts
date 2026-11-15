import type { BackupTarEntry } from '@/tests/server/Admin/Backups/archive-tar.test.types.ts'
import type { TestTarEntry } from '@/tests/server/Admin/Backups/backupTarTestUtils.types.ts'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { encryptBackupArchiveService } from './archive-envelope-fixture.test.helpers.ts'
import { pack } from 'tar-stream'
import type { Pack } from 'tar-stream'
import { BACKUP_MANIFEST_VERSION } from '@/config/backup.config.ts'
import {
    BACKUP_INTEGRITY_FILE_NAME,
    createBackupIntegrityTracker,
} from './archive-format-fixture.test.helpers.ts'

import type {
    LegacyTestBackupArchiveIntegrity,
    TestBackupArchiveIntegrity,
} from './backupTarTestUtils.types.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

function createLegacyTestBackupIntegrityTracker() {
    const hash = createHash('sha256')
    hash.update('tanstack-backup-integrity-v1\0')
    let entryCount = 0
    let totalBytes = 0

    return {
        startEntry(entry: BackupTarEntry) {
            const pathBytes = Buffer.from(entry.path, 'utf8')
            const metadata = Buffer.alloc(4 + 1 + 8)
            metadata.writeUInt32BE(pathBytes.length, 0)
            metadata.writeUInt8(entry.type === 'file' ? 1 : 2, 4)
            metadata.writeBigUInt64BE(BigInt(entry.size), 5)
            hash.update(metadata)
            hash.update(pathBytes)
            entryCount += 1

            if (entry.type === 'file') {
                totalBytes += entry.size
            }
        },
        update(chunk: Uint8Array) {
            hash.update(chunk)
        },
        finishEntry() {},
        complete(): LegacyTestBackupArchiveIntegrity {
            return {
                version: 1,
                algorithm: 'sha256',
                entryCount,
                totalBytes,
                checksumSha256: hash.digest('hex'),
            }
        },
    }
}

function addTarEntry(archive: Pack, entry: TestTarEntry) {
    const type = entry.type ?? 'file'
    const hasBody = type === 'file' || type === 'contiguous-file'
    const content = Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? '', 'utf8')
    const header = {
        linkname: entry.linkname,
        mode: type === 'directory' ? 0o700 : 0o600,
        mtime: new Date(0),
        name: entry.name,
        pax: entry.pax,
        size: hasBody ? content.length : 0,
        type,
    }

    return new Promise<void>(function (resolve, reject) {
        if (!hasBody) {
            archive.entry(header, function (error) {
                if (error) {
                    reject(error)
                    return
                }

                resolve()
            })
            return
        }

        archive.entry(header, content, function (error) {
            if (error) {
                reject(error)
                return
            }

            resolve()
        })
    })
}

async function addTrackedEntry(
    archive: Pack,
    entry: TestTarEntry,
    integrity: Pick<
        ReturnType<typeof createBackupIntegrityTracker>,
        'finishEntry' | 'startEntry' | 'update'
    >,
) {
    const type = entry.type ?? 'file'
    const content = Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? '', 'utf8')

    if (type === 'file' || type === 'directory') {
        integrity.startEntry({
            path: entry.pax?.path ?? entry.name.replace(/\/$/, ''),
            size: type === 'directory' ? 0 : content.length,
            type,
        })

        if (type === 'file') {
            integrity.update(content)
        }

        integrity.finishEntry()
    }

    await addTarEntry(archive, entry)
}

async function writeTestBackupArchive(
    filePath: string,
    entries: TestTarEntry[],
    options: {
        entriesAfterIntegrity?: TestTarEntry[]
        integrityOverride?: (integrity: TestBackupArchiveIntegrity) => unknown
        legacyIntegrity?: boolean
        omitIntegrity?: boolean
    } = {},
) {
    const integrity = options.legacyIntegrity
        ? createLegacyTestBackupIntegrityTracker()
        : createBackupIntegrityTracker()
    await mkdir(path.dirname(filePath), { recursive: true })
    const archive = pack()
    const completed = encryptBackupArchiveService({
        source: archive,
        destination: createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
    })
    void completed.catch(function () {})

    try {
        await forEachSequentially(entries, async function (entry) {
            await addTrackedEntry(archive, entry, integrity)
        })

        if (!options.omitIntegrity) {
            const integrityValue = integrity.complete()
            const integrityContent = JSON.stringify(
                options.integrityOverride
                    ? options.integrityOverride(integrityValue)
                    : integrityValue,
            )
            await addTarEntry(archive, {
                content: integrityContent,
                name: BACKUP_INTEGRITY_FILE_NAME,
            })
        }

        await forEachSequentially(
            options.entriesAfterIntegrity ?? [],
            async function (entry) {
                await addTarEntry(archive, entry)
            },
        )

        archive.finalize()
        await completed
    } catch (error) {
        archive.destroy(error instanceof Error ? error : undefined)
        await completed.catch(function () {})
        throw error
    }
}

export async function createTestBackupArchive(
    filePath: string,
    input: {
        appVersion?: string
        databaseDump: Buffer | string
        entriesAfterIntegrity?: TestTarEntry[]
        extraEntries?: TestTarEntry[]
        includesStorage?: boolean
        integrityOverride?: (integrity: TestBackupArchiveIntegrity) => unknown
        legacyIntegrity?: boolean
        manifest?: unknown
        omitIntegrity?: boolean
        storageAsFile?: boolean
    },
) {
    const manifest =
        input.manifest === undefined
            ? {
                  version: BACKUP_MANIFEST_VERSION,
                  createdAt: new Date().toISOString(),
                  appVersion: input.appVersion ?? 'test-version',
                  includesStorage: input.includesStorage ?? false,
                  ...(input.includesStorage
                      ? { privateBackgroundsVersion: 1 }
                      : {}),
              }
            : input.manifest
    const entries: TestTarEntry[] = [
        { content: JSON.stringify(manifest), name: 'manifest.json' },
        { content: input.databaseDump, name: 'database.dump' },
    ]

    if (input.includesStorage) {
        entries.push(
            input.storageAsFile
                ? { content: 'invalid-storage', name: 'storage' }
                : { name: 'storage', type: 'directory' },
        )

        if (!input.storageAsFile) {
            entries.push({
                content: 'restored-storage',
                name: 'storage/restored.txt',
            })
        }
    }

    entries.push(...(input.extraEntries ?? []))
    await writeTestBackupArchive(filePath, entries, {
        entriesAfterIntegrity: input.entriesAfterIntegrity,
        integrityOverride: input.integrityOverride,
        legacyIntegrity: input.legacyIntegrity,
        omitIntegrity: input.omitIntegrity,
    })
}
