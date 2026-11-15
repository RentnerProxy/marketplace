import path from 'node:path'
import os from 'node:os'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import {
    encryptBackupArchiveService,
    authenticateBackupArchiveService as readNodeEnvelope,
} from './archive-envelope-fixture.test.helpers.ts'

const fixtureKey = Buffer.alloc(32, 17).toString('base64')
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: () => fixtureKey,
}))
const { authenticateBackupArchiveService } =
    await import('@/server/Admin/Backups/archive-encryption.service.ts')
let directory = ''
beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'archive-cross-language-'))
})
afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
})

describe('Node/Rust archive envelope compatibility', () => {
    it('authenticates Node AES-256-GCM envelopes in Rust with the exact on-disk checksum', async () => {
        const sourcePath = path.join(directory, 'node.enc')
        const metadata = await encryptBackupArchiveService({
            source: Readable.from([Buffer.alloc(200000, 37)]),
            destination: createWriteStream(sourcePath),
        })
        expect(await authenticateBackupArchiveService({ sourcePath })).toEqual(
            metadata,
        )
        const bytes = await readFile(sourcePath)
        bytes[bytes.length - 1] ^= 1
        await writeFile(sourcePath, bytes)
        await expect(
            authenticateBackupArchiveService({ sourcePath }),
        ).rejects.toThrow()
    })
    it('decrypts a streaming Rust envelope with the independent Node reader', async () => {
        const plaintext = Buffer.alloc(300003, 43)
        const sourcePath = path.join(directory, 'plain.tar')
        const destinationPath = path.join(directory, 'rust.enc')
        await writeFile(sourcePath, plaintext)
        const result = await runCoreCommandService('archive', {
            operation: 'encrypt',
            sourcePath,
            destinationPath,
            key: fixtureKey,
        })
        expect(result).toMatchObject({ plaintextSize: plaintext.length })
        const handle = await open(destinationPath, 'r')
        try {
            const chunks: Buffer[] = []
            const destination = new Writable({
                write(chunk, _encoding, callback) {
                    chunks.push(Buffer.from(chunk))
                    callback()
                },
            })
            const verified = await readNodeEnvelope({
                source: handle,
                destination,
            })
            expect(verified.plaintextSize).toBe(plaintext.length)
            expect(Buffer.concat(chunks)).toEqual(plaintext)
        } finally {
            await handle.close()
        }
    })
})
