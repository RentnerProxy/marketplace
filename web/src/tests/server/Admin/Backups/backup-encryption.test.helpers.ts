import { createWriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import {
    authenticateBackupArchiveService,
    encryptBackupArchiveService,
} from './archive-envelope-fixture.test.helpers.ts'

export async function readTestBackupTar(filePath: string): Promise<Buffer> {
    const source = await open(filePath, 'r')
    const chunks: Buffer[] = []
    const destination = new Writable({
        write(chunk, _encoding, callback) {
            if (!(chunk instanceof Uint8Array)) {
                callback(new Error('Invalid synthetic archive chunk'))
                return
            }
            chunks.push(Buffer.from(chunk))
            callback()
        },
    })
    try {
        await authenticateBackupArchiveService({ source, destination })
        return Buffer.concat(chunks)
    } finally {
        destination.destroy()
        await source.close()
    }
}

export async function replaceTestBackupTar(
    filePath: string,
    plaintext: Buffer,
): Promise<void> {
    await encryptBackupArchiveService({
        source: Readable.from([plaintext]),
        destination: createWriteStream(filePath, { flags: 'w', mode: 0o600 }),
    })
}
