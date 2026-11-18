import { createHash } from 'node:crypto'

export function byteIdentity(bytes: Buffer) {
    return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
    }
}

export function jsonBytes(value: object) {
    return Buffer.from(JSON.stringify(value, null, 2) + '\n')
}
