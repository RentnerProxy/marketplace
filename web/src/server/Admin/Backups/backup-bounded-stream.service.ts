import { Transform } from 'node:stream'
import { callbackify } from 'node:util'
import type { BackupImportContext } from './import.types.ts'
import type { BackupBoundedStreamOptions } from './Types/backup-bounded-stream.types.ts'

export function createBoundedBackupStreamService(
    context: BackupImportContext,
    options: BackupBoundedStreamOptions,
) {
    let observedBytes = 0
    let pendingWrite: Promise<Buffer> | undefined

    async function processChunk(chunk: unknown) {
        context.assertActive()
        if (!(chunk instanceof Uint8Array)) {
            throw new Error(options.invalidChunkMessage)
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        observedBytes += buffer.length
        if (observedBytes > options.getMaximumBytes()) {
            throw new Error(options.sizeLimitMessage)
        }
        await context.beforeWrite(buffer.length)
        context.assertActive()
        return buffer
    }

    return {
        getObservedBytes: () => observedBytes,
        stream: new Transform({
            transform(chunk, _encoding, callback) {
                const task = processChunk(chunk)
                pendingWrite = task
                callbackify(() => task)(callback)
            },
        }),
        settle: async function () {
            await pendingWrite?.catch(() => undefined)
        },
    }
}
