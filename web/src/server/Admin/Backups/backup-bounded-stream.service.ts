import type { FileHandle } from 'node:fs/promises'
import type {
    BackupBoundedStreamOptions,
    BackupImportContext,
} from './Types/import.types.ts'

export async function writeBoundedBackupStreamService(
    body: ReadableStream<Uint8Array>,
    file: FileHandle,
    context: BackupImportContext,
    options: BackupBoundedStreamOptions,
): Promise<number> {
    const reader = body.getReader()
    let writtenBytes = 0

    function abortRead() {
        void reader.cancel(context.signal.reason).catch(() => undefined)
    }

    context.signal.addEventListener('abort', abortRead, { once: true })
    try {
        // Keep each read, reservation and write ordered for backpressure and cleanup.
        /* oxlint-disable no-await-in-loop */
        while (true) {
            context.assertActive()
            const { done, value: chunk } = await reader.read()
            context.assertActive()
            if (done) return writtenBytes
            if (!(chunk instanceof Uint8Array)) {
                throw new Error(options.invalidChunkMessage)
            }
            if (chunk.byteLength > options.maximumBytes - writtenBytes) {
                throw new Error(options.sizeLimitMessage)
            }
            await context.beforeWrite(chunk.byteLength)
            let offset = 0
            while (offset < chunk.byteLength) {
                context.assertActive()
                const { bytesWritten } = await file.write(
                    chunk,
                    offset,
                    chunk.byteLength - offset,
                    writtenBytes,
                )
                if (bytesWritten === 0) {
                    throw new Error(
                        'Der Backup-Upload konnte nicht geschrieben werden.',
                    )
                }
                offset += bytesWritten
                writtenBytes += bytesWritten
            }
        }
        /* oxlint-enable no-await-in-loop */
    } catch (error) {
        void reader.cancel(error).catch(() => undefined)
        throw error
    } finally {
        context.signal.removeEventListener('abort', abortRead)
        reader.releaseLock()
    }
}
