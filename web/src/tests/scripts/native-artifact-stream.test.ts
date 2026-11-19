import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyNativeArtifactStream } from '@/lib/Core/native-tool.ts'

test('native artifact streaming persists only the bounded, digest-matched bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-artifact-'))
    const destination = join(directory, 'received.bin')
    const bytes = Buffer.alloc(1024 * 1024 + 17, 0x8a)
    const identity = {
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    try {
        expect(
            await verifyNativeArtifactStream(
                new Blob([bytes]).stream(),
                { ...identity, sizeBytes: 4096 },
                destination,
            ),
        ).toBe('length-exceeded')
        expect(await readdir(directory)).toEqual([])
        expect(
            await verifyNativeArtifactStream(
                new Blob([bytes]).stream(),
                { ...identity, sha256: '0'.repeat(64) },
                destination,
            ),
        ).toBe('mismatch')
        expect(await readdir(directory)).toEqual([])
        expect(
            await verifyNativeArtifactStream(
                new Blob([bytes]).stream(),
                identity,
                destination,
            ),
        ).toBe('verified')
        expect(await readFile(destination)).toEqual(bytes)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
