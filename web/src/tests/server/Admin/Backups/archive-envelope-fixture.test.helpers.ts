// Independent Node envelope implementation for small compatibility fixtures only.
/* oxlint-disable no-await-in-loop -- Fixture encryption consumes ordered stream chunks before authenticating the tag. */
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    hkdfSync,
    randomBytes,
} from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'

function key(salt: Uint8Array) {
    return Buffer.from(
        hkdfSync(
            'sha256',
            Buffer.from(
                getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
                'base64',
            ),
            salt,
            'tanstackdummy/backup/envelope-v1/aes-256-gcm',
            32,
        ),
    )
}

export async function encryptBackupArchiveService(input: {
    source: Readable | AsyncIterable<unknown>
    destination: Writable
    signal?: AbortSignal
}) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of input.source) {
        if (!(chunk instanceof Uint8Array))
            throw new Error('Invalid fixture bytes')
        size += chunk.length
        if (size > 16 * 1024 * 1024)
            throw new Error('Synthetic fixture exceeds 16 MiB')
        chunks.push(Buffer.from(chunk))
    }
    const header = Buffer.concat([
        Buffer.from('TDBAKENC\x01\x01', 'binary'),
        randomBytes(32),
        randomBytes(12),
    ])
    const cipher = createCipheriv(
        'aes-256-gcm',
        key(header.subarray(10, 42)),
        header.subarray(42),
    )
    cipher.setAAD(header)
    const ciphertext = Buffer.concat([
        header,
        cipher.update(Buffer.concat(chunks)),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    await pipeline(Readable.from([ciphertext]), input.destination, {
        signal: input.signal,
    })
    return {
        archiveSize: ciphertext.length,
        plaintextSize: size,
        checksumSha256: createHash('sha256').update(ciphertext).digest('hex'),
    }
}

export async function authenticateBackupArchiveService(input: {
    source: FileHandle
    destination?: Writable
    signal?: AbortSignal
    expectedChecksumSha256?: string
}) {
    const stats = await input.source.stat()
    if (stats.size > 16 * 1024 * 1024)
        throw new Error('Synthetic fixture exceeds 16 MiB')
    const data = Buffer.alloc(stats.size)
    let position = 0
    while (position < data.length) {
        const result = await input.source.read(
            data,
            position,
            data.length - position,
            position,
        )
        if (!result.bytesRead) throw new Error('Truncated synthetic fixture')
        position += result.bytesRead
    }
    const decipher = createDecipheriv(
        'aes-256-gcm',
        key(data.subarray(10, 42)),
        data.subarray(42, 54),
    )
    decipher.setAAD(data.subarray(0, 54))
    decipher.setAuthTag(data.subarray(data.length - 16))
    const plaintext = Buffer.concat([
        decipher.update(data.subarray(54, -16)),
        decipher.final(),
    ])
    const checksumSha256 = createHash('sha256').update(data).digest('hex')
    if (
        input.expectedChecksumSha256 &&
        input.expectedChecksumSha256 !== checksumSha256
    )
        throw new Error('Fixture checksum differs')
    if (input.destination)
        await pipeline(Readable.from([plaintext]), input.destination, {
            signal: input.signal,
        })
    return {
        archiveSize: data.length,
        plaintextSize: plaintext.length,
        checksumSha256,
    }
}
