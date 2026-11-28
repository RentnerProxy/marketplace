import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import {
    BACKUP_ARCHIVE_ENCRYPTION_CONFIG,
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_DOWNLOAD_CHUNK_BYTES,
    BACKUP_LIMITS,
    BACKUP_TIMEOUTS,
} from '@/config/backup.config.ts'
import { authenticateBackupArchiveService } from './archive-core.service.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { BackupApiError } from './http.service.ts'
import type {
    PrepareBackupDownloadInput,
    PreparedBackupDownload,
} from './Types/backup-download.types.ts'

function createDownloadAbortError() {
    return new BackupApiError(408, 'Der Backup-Download wurde abgebrochen.')
}

export async function prepareBackupDownloadService(
    input: PrepareBackupDownloadInput,
): Promise<PreparedBackupDownload> {
    if (!input.fileName.endsWith(BACKUP_ARCHIVE_EXTENSION)) {
        throw new BackupApiError(
            409,
            'Dieses unverschlüsselte Backupformat wird nicht mehr unterstützt. Erstelle ein neues Backup.',
        )
    }
    if (
        input.fileSize === null ||
        !Number.isSafeInteger(input.fileSize) ||
        input.fileSize <= 0 ||
        input.fileSize > BACKUP_LIMITS.maxArchiveBytes ||
        input.checksumSha256 === null ||
        !/^[a-f0-9]{64}$/i.test(input.checksumSha256)
    ) {
        throw new BackupApiError(
            409,
            'Für dieses Backup fehlen vollständig verifizierte Dateimetadaten.',
        )
    }

    const controller = new AbortController()
    function abortRequest() {
        controller.abort(createDownloadAbortError())
    }
    input.signal?.addEventListener('abort', abortRequest, { once: true })
    if (input.signal?.aborted) abortRequest()
    const deadline = setTimeout(
        abortRequest,
        BACKUP_TIMEOUTS.maximumDownloadDurationMs,
    )
    deadline.unref()
    let file: Awaited<ReturnType<typeof open>> | undefined
    let disposed = false
    let bodyCreated = false
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let closePromise: Promise<void> | undefined

    function assertActive() {
        if (controller.signal.aborted || disposed) {
            throw createDownloadAbortError()
        }
    }

    function dispose() {
        if (closePromise) return closePromise
        disposed = true
        clearTimeout(deadline)
        input.signal?.removeEventListener('abort', abortRequest)
        controller.signal.removeEventListener('abort', abortBody)
        closePromise = file?.close() ?? Promise.resolve()
        return closePromise
    }

    function abortBody() {
        bodyController?.error(createDownloadAbortError())
        void dispose().catch(function () {})
    }

    try {
        assertActive()
        const filePath = await getBackupFilePath(input.fileName)
        assertActive()
        const pathStats = await lstat(filePath)
        assertActive()
        if (
            !pathStats.isFile() ||
            pathStats.isSymbolicLink() ||
            pathStats.nlink !== 1 ||
            pathStats.size !== input.fileSize
        ) {
            throw new BackupApiError(
                400,
                'Die Backup-Datei stimmt nicht mit dem bestätigten Katalog überein.',
            )
        }
        file = await open(
            filePath,
            fsConstants.O_RDONLY |
                (fsConstants.O_NOFOLLOW ?? 0) |
                (fsConstants.O_NONBLOCK ?? 0),
        )
        assertActive()
        const openedFile = file
        const openedStats = await openedFile.stat()
        assertActive()
        if (
            !openedStats.isFile() ||
            openedStats.nlink !== 1 ||
            openedStats.dev !== pathStats.dev ||
            openedStats.ino !== pathStats.ino ||
            openedStats.size !== input.fileSize
        ) {
            throw new BackupApiError(
                400,
                'Die Backup-Datei wurde während der Zugriffsprüfung verändert.',
            )
        }
        const prefix = Buffer.alloc(
            BACKUP_ARCHIVE_ENCRYPTION_CONFIG.magic.length,
        )
        async function readPrefix(position: number): Promise<number> {
            const result = await openedFile.read(
                prefix,
                position,
                prefix.length - position,
                position,
            )
            assertActive()
            const nextPosition = position + result.bytesRead
            if (result.bytesRead === 0 || nextPosition === prefix.length) {
                return nextPosition
            }
            return readPrefix(nextPosition)
        }
        const prefixBytes = await readPrefix(0)
        if (
            prefixBytes !== prefix.length ||
            !prefix.equals(
                Buffer.from(BACKUP_ARCHIVE_ENCRYPTION_CONFIG.magic, 'ascii'),
            )
        ) {
            throw new BackupApiError(
                409,
                'Dieses unverschlüsselte Backupformat wird nicht mehr unterstützt. Erstelle ein neues Backup.',
            )
        }

        const sourceSnapshot = await openedFile.stat({ bigint: true })
        const verified = await authenticateBackupArchiveService({
            sourcePath: filePath,
            expectedSourceIdentity: {
                dev: String(sourceSnapshot.dev),
                ino: String(sourceSnapshot.ino),
                size: String(sourceSnapshot.size),
                mtimeNs: String(sourceSnapshot.mtimeNs),
                ctimeNs: String(sourceSnapshot.ctimeNs),
            },
            expectedChecksumSha256: input.checksumSha256,
            signal: controller.signal,
        })
        assertActive()
        if (verified.archiveSize !== input.fileSize) {
            throw new BackupApiError(
                400,
                'Die Backup-Datei stimmt nicht mit dem bestätigten Katalog überein.',
            )
        }

        controller.signal.addEventListener('abort', abortBody, { once: true })
        assertActive()
        return {
            fileName: input.fileName,
            fileSize: verified.archiveSize,
            dispose,
            createBody() {
                assertActive()
                if (bodyCreated) {
                    throw new Error(
                        'Der Backup-Download wurde bereits geöffnet.',
                    )
                }
                bodyCreated = true
                let position = 0

                return new ReadableStream<Uint8Array>({
                    start(streamController) {
                        bodyController = streamController
                    },
                    async pull(streamController) {
                        try {
                            assertActive()
                            const remaining = verified.archiveSize - position
                            if (remaining === 0) {
                                await dispose()
                                streamController.close()
                                return
                            }
                            const buffer = Buffer.allocUnsafe(
                                Math.min(
                                    BACKUP_DOWNLOAD_CHUNK_BYTES,
                                    remaining,
                                ),
                            )
                            const result = await openedFile.read(
                                buffer,
                                0,
                                buffer.length,
                                position,
                            )
                            assertActive()
                            if (result.bytesRead === 0) {
                                throw new Error(
                                    'Die Backup-Datei wurde während der Übertragung verändert.',
                                )
                            }
                            position += result.bytesRead
                            streamController.enqueue(
                                buffer.subarray(0, result.bytesRead),
                            )
                            if (position === verified.archiveSize) {
                                await dispose()
                                streamController.close()
                            }
                        } catch (error) {
                            await dispose().catch(function () {})
                            if (!controller.signal.aborted) {
                                streamController.error(error)
                            }
                        }
                    },
                    cancel() {
                        return dispose()
                    },
                })
            },
        }
    } catch (error) {
        await dispose()
        if (controller.signal.aborted) throw createDownloadAbortError()
        if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            throw new BackupApiError(404, 'Backup-Datei nicht gefunden.')
        }
        throw error
    }
}
