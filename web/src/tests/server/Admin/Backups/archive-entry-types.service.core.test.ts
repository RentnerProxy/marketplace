import { createBackupImportTestContext } from './import-context.test.helpers.ts'
import {
    readTestBackupTar,
    replaceTestBackupTar,
} from './backup-encryption.test.helpers.ts'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { Header } from 'tar-stream'
import { validateBackupArchive as validateEncryptedBackupArchive } from '@/server/Admin/Backups/archive-validation.service.ts'
import { createTestBackupArchive } from './backupTarTestUtils.ts'

let testRoot = ''
let previousAuthKey: string | undefined

function validateBackupArchive(filePath: string) {
    return validateEncryptedBackupArchive(
        filePath,
        createBackupImportTestContext(testRoot).context,
    )
}

async function createTestArchive(filePath: string) {
    await createTestBackupArchive(filePath, {
        databaseDump: 'database',
        includesStorage: true,
    })
}

function encodePositiveBase256(field: Buffer, value: number) {
    field.fill(0)
    field[0] = 0x80
    let remaining = BigInt(value)

    for (let index = field.length - 1; index > 0; index -= 1) {
        field[index] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
}

function updateTarHeaderChecksum(header: Buffer) {
    header.fill(0x20, 148, 156)
    const checksum = header.reduce((total, byte) => total + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
    header[154] = 0
    header[155] = 0x20
}

beforeEach(async function () {
    previousAuthKey = process.env.AUTH_ENCRYPTION_KEY
    process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'backup-entry-test-'))
})

afterEach(async function () {
    if (previousAuthKey === undefined) {
        delete process.env.AUTH_ENCRYPTION_KEY
    } else {
        process.env.AUTH_ENCRYPTION_KEY = previousAuthKey
    }
    await rm(testRoot, { force: true, recursive: true })
})

describe('Backup-Archiveintragstypen', function () {
    it('lehnt ein korrekt selbstgehashtes Legacy-Archiv ab', async function () {
        const filePath = path.join(testRoot, 'legacy.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'untrusted-sql-dump',
            legacyIntegrity: true,
        })
        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt ein unter einem fremden Schlüssel erzeugtes Archiv ab', async function () {
        const filePath = path.join(testRoot, 'foreign-key.tar')
        await createTestArchive(filePath)
        const innerTar = await readTestBackupTar(filePath)
        process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64')
        await replaceTestBackupTar(filePath, innerTar)
        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it.each(['dump', 'manifest', 'path', 'order'] as const)(
        'erkennt Manipulationen am authentisierten %s trotz gültigem TAR',
        async function (change) {
            const filePath = path.join(testRoot, 'tampered.tar')
            await createTestArchive(filePath)
            let archive = await readTestBackupTar(filePath)
            if (change === 'order') {
                expect(archive.subarray(1024, 1037).toString('utf8')).toBe(
                    'database.dump',
                )
                archive = Buffer.concat([
                    archive.subarray(1024, 2048),
                    archive.subarray(0, 1024),
                    archive.subarray(2048),
                ])
            } else {
                const original =
                    change === 'dump'
                        ? 'database'
                        : change === 'manifest'
                          ? 'test-version'
                          : 'storage/restored.txt'
                const replacement =
                    change === 'dump'
                        ? 'modified'
                        : change === 'manifest'
                          ? 'evil-version'
                          : 'storage/injected.txt'
                const offset =
                    change === 'dump'
                        ? 1536
                        : archive.indexOf(original, 0, 'utf8')
                expect(offset).toBeGreaterThanOrEqual(0)
                expect(
                    archive
                        .subarray(offset, offset + original.length)
                        .toString('utf8'),
                ).toBe(original)
                archive.write(replacement, offset, 'utf8')
                if (change === 'path') {
                    updateTarHeaderChecksum(
                        archive.subarray(offset, offset + 512),
                    )
                }
            }
            await replaceTestBackupTar(filePath, archive)
            await expect(validateBackupArchive(filePath)).rejects.toMatchObject(
                { code: 'ARCHIVE_INVALID' },
            )
        },
    )

    it.each([
        'missing',
        'length',
        'uppercase',
        'algorithm',
        'version',
        'extra',
    ] as const)(
        'lehnt ungültige Authentisierungsmetadaten ab: %s',
        async function (fault) {
            const filePath = path.join(testRoot, 'invalid-authentication.tar')
            await createTestBackupArchive(filePath, {
                databaseDump: 'database',
                integrityOverride(integrity) {
                    if (integrity.algorithm !== 'hmac-sha256') {
                        throw new Error('Expected authenticated fixture')
                    }
                    switch (fault) {
                        case 'missing': {
                            const { hmacSha256: _tag, ...metadata } = integrity
                            return metadata
                        }
                        case 'length':
                            return { ...integrity, hmacSha256: 'a'.repeat(62) }
                        case 'uppercase':
                            return { ...integrity, hmacSha256: 'A'.repeat(64) }
                        case 'algorithm':
                            return { ...integrity, algorithm: 'none' }
                        case 'version':
                            return { ...integrity, version: 1 }
                        case 'extra':
                            return { ...integrity, trusted: true }
                    }
                    throw new Error('Unbekannter Integritätsfehler im Test.')
                },
            })
            await expect(validateBackupArchive(filePath)).rejects.toMatchObject(
                { code: 'ARCHIVE_INVALID' },
            )
        },
    )

    it.each([undefined, 'invalid-key', Buffer.alloc(31, 7).toString('base64')])(
        'erzeugt ohne gültigen Schlüssel keine Ausgabedatei (%s)',
        async function (key) {
            if (key === undefined) {
                delete process.env.AUTH_ENCRYPTION_KEY
            } else {
                process.env.AUTH_ENCRYPTION_KEY = key
            }
            const filePath = path.join(testRoot, 'missing-key.tar')
            await expect(createTestArchive(filePath)).rejects.toThrow(
                'AUTH_ENCRYPTION_KEY',
            )
            await expect(readFile(filePath)).rejects.toMatchObject({
                code: 'ENOENT',
            })
        },
    )

    it('akzeptiert reguläre Dateien und echte Storage-Verzeichnisse', async function () {
        const filePath = path.join(testRoot, 'valid.tar')
        await createTestArchive(filePath)

        await expect(validateBackupArchive(filePath)).resolves.toMatchObject({
            manifest: { includesStorage: true },
        })
    })

    it('akzeptiert positive Base-256-Größenfelder für große TAR-Einträge', async function () {
        const filePath = path.join(testRoot, 'base-256-size.tar')
        await createTestArchive(filePath)
        const archive = await readTestBackupTar(filePath)
        let databaseHeaderOffset = -1

        for (let offset = 0; offset < archive.length; offset += 512) {
            if (
                archive
                    .subarray(offset, offset + 'database.dump'.length)
                    .equals(Buffer.from('database.dump', 'ascii'))
            ) {
                databaseHeaderOffset = offset
                break
            }
        }

        expect(databaseHeaderOffset).toBeGreaterThanOrEqual(0)
        const databaseHeader = archive.subarray(
            databaseHeaderOffset,
            databaseHeaderOffset + 512,
        )
        encodePositiveBase256(databaseHeader.subarray(124, 136), 8)
        updateTarHeaderChecksum(databaseHeader)
        await replaceTestBackupTar(filePath, archive)

        await expect(validateBackupArchive(filePath)).resolves.toMatchObject({
            manifest: { includesStorage: true },
        })
    })

    it.each<[string, Header['type'], string | undefined]>([
        ['Hardlink', 'link', 'storage/restored.txt'],
        ['Symlink', 'symlink', '../outside'],
        ['Character-Device', 'character-device', undefined],
        ['Block-Device', 'block-device', undefined],
        ['FIFO', 'fifo', undefined],
        ['zusammenhängende Datei', 'contiguous-file', undefined],
    ])(
        'lehnt den TAR-Sondertyp %s ab',
        async function (_label, type, linkname) {
            const filePath = path.join(testRoot, `special-${type}.tar`)
            await createTestBackupArchive(filePath, {
                databaseDump: 'database',
                includesStorage: true,
                extraEntries: [
                    {
                        linkname,
                        name: 'storage/unsupported',
                        type,
                    },
                ],
            })

            await expect(validateBackupArchive(filePath)).rejects.toMatchObject(
                { code: 'ARCHIVE_INVALID' },
            )
        },
    )

    it('lehnt einen als Datei deklarierten Storage-Wurzelpfad ab', async function () {
        const filePath = path.join(testRoot, 'invalid-directory.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            storageAsFile: true,
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('akzeptiert ausschließlich den final validierten Pfad aus einem PAX-Header', async function () {
        const filePath = path.join(testRoot, 'valid-pax.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                {
                    content: 'pax-content',
                    name: 'storage/pax-placeholder.txt',
                    pax: { path: 'storage/pax-value.txt' },
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).resolves.toMatchObject({
            manifest: { includesStorage: true },
        })
    })

    it('lehnt Pfadtraversal aus einem PAX-Header ab', async function () {
        const filePath = path.join(testRoot, 'pax-traversal.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                {
                    content: 'outside',
                    name: 'storage/pax-placeholder.txt',
                    pax: { path: '../outside.txt' },
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt nicht unterstützte PAX-Metadaten ab', async function () {
        const filePath = path.join(testRoot, 'unsupported-pax.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                {
                    content: 'pax-content',
                    name: 'storage/pax-placeholder.txt',
                    pax: {
                        comment: 'unsupported',
                        path: 'storage/pax-value.txt',
                    },
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt doppelte portable Archivpfade ab', async function () {
        const filePath = path.join(testRoot, 'duplicate.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                {
                    content: 'duplicate',
                    name: 'storage/RESTORED.txt',
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt Unicode-Pfade ab, die unter Windows dieselbe Datei bezeichnen', async function () {
        const filePath = path.join(testRoot, 'unicode-case-collision.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                { content: 'sigma', name: 'storage/σ.txt' },
                { content: 'final-sigma', name: 'storage/ς.txt' },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it.each([
        'a?.txt',
        'CONIN$',
        'COM¹.txt',
        `control${String.fromCharCode(1)}.txt`,
    ])(
        'lehnt den Windows-inkompatiblen Archivpfad %s ab',
        async function (fileName) {
            const filePath = path.join(testRoot, 'invalid-windows-path.tar')
            await createTestBackupArchive(filePath, {
                databaseDump: 'database',
                includesStorage: true,
                extraEntries: [
                    { content: 'invalid', name: `storage/${fileName}` },
                ],
            })

            await expect(validateBackupArchive(filePath)).rejects.toMatchObject(
                { code: 'ARCHIVE_INVALID' },
            )
        },
    )

    it('begrenzt die Verschachtelung von Archivpfaden', async function () {
        const filePath = path.join(testRoot, 'deep-path.tar')
        const deepPath = `storage/${Array.from({ length: 64 }, () => 'a').join('/')}`
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [{ content: 'deep', name: deepPath }],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('begrenzt einzelne Pfadkomponenten portabel auf 255 Bytes und Zeichen', async function () {
        const filePath = path.join(testRoot, 'long-segment.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            includesStorage: true,
            extraEntries: [
                {
                    content: 'long',
                    name: `storage/${'a'.repeat(256)}`,
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt ein Backup ohne Integritätsinformationen ab', async function () {
        const filePath = path.join(testRoot, 'missing-integrity.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            omitIntegrity: true,
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt manipulierte Dateiinhalte über die interne Integritätsprüfung ab', async function () {
        const filePath = path.join(testRoot, 'tampered-content.tar')
        await createTestArchive(filePath)
        const archive = await readTestBackupTar(filePath)
        const contentOffset = archive.indexOf('restored-storage', 0, 'utf8')

        expect(contentOffset).toBeGreaterThanOrEqual(0)
        archive[contentOffset] = (archive[contentOffset] ?? 0) ^ 0xff
        await replaceTestBackupTar(filePath, archive)

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt Archiveinträge nach den Integritätsinformationen ab', async function () {
        const filePath = path.join(testRoot, 'entry-after-integrity.tar')
        await createTestBackupArchive(filePath, {
            databaseDump: 'database',
            entriesAfterIntegrity: [
                {
                    content: 'late-entry',
                    name: 'storage/late.txt',
                },
            ],
        })

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })

    it('lehnt ein TAR mit nur einem Abschlussblock als unvollständig ab', async function () {
        const filePath = path.join(testRoot, 'truncated-footer.tar')
        await createTestBackupArchive(filePath, { databaseDump: 'database' })
        const archive = await readTestBackupTar(filePath)
        await replaceTestBackupTar(filePath, archive.subarray(0, -512))

        await expect(validateBackupArchive(filePath)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
    })
})
