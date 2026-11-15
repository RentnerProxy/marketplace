import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import {
    archiveAdmissionSchema,
    parseArchiveCoreResultService as parse,
} from '@/server/Admin/Backups/archive-core.schema.ts'

const manifest = {
    version: 3,
    createdAt: '2026-11-10T09:00:00.000Z',
    appVersion: 'test',
    includesStorage: false,
}
const metadata = {
    archiveSize: 170,
    plaintextSize: 100,
    checksumSha256: 'a'.repeat(64),
}
const absolute = path.resolve('fixture')

describe('Archive native result contracts', () => {
    it.each(['create', 'encrypt', 'decrypt', 'authenticate'])(
        'checks %s envelope lengths and checksums',
        (operation) => {
            expect(parse(operation, metadata)).toEqual(metadata)
            expect(() =>
                parse(operation, { ...metadata, archiveSize: 171 }),
            ).toThrow()
            expect(() =>
                parse(operation, {
                    ...metadata,
                    checksumSha256: 'A'.repeat(64),
                }),
            ).toThrow()
            expect(() =>
                parse(operation, { ...metadata, plaintextSize: -1 }),
            ).toThrow()
            expect(() =>
                parse(operation, { ...metadata, extra: true }),
            ).toThrow()
        },
    )
    it.each(['validate', 'extract'])(
        'requires an exact supported manifest for %s',
        (operation) => {
            const response = {
                archiveSize: 170,
                checksumSha256: 'a'.repeat(64),
                manifest,
            }
            expect(parse(operation, response)).toEqual(response)
            expect(() =>
                parse(operation, {
                    ...response,
                    archiveSize: BACKUP_LIMITS.maxArchiveBytes + 1,
                }),
            ).toThrow()
            expect(() =>
                parse(operation, {
                    ...response,
                    manifest: { ...manifest, includesStorage: true },
                }),
            ).toThrow()
            expect(() =>
                parse(operation, {
                    ...response,
                    manifest: { ...manifest, extra: true },
                }),
            ).toThrow()
            expect(
                parse(operation, {
                    ...response,
                    manifest: {
                        ...manifest,
                        includesStorage: true,
                        privateBackgroundsVersion: 1,
                    },
                }),
            ).toBeDefined()
            expect(
                parse(operation, {
                    ...response,
                    manifest: {
                        ...manifest,
                        version: 2,
                        includesStorage: true,
                    },
                }),
            ).toBeDefined()
        },
    )
    it('validates collection, entry and bounded copy metadata', () => {
        const file = { path: 'storage/image.webp', size: 10, type: 'file' }
        const directory = { path: 'storage', size: 0, type: 'directory' }
        expect(parse('validateEntry', file)).toEqual(file)
        expect(parse('validateEntry', directory)).toEqual(directory)
        expect(() =>
            parse('validateEntry', { ...directory, size: 1 }),
        ).toThrow()
        expect(() =>
            parse('validateEntry', { ...file, path: '../outside' }),
        ).toThrow()
        expect(
            parse('collect', [
                { ...file, absolutePath: absolute },
                { ...directory, absolutePath: null },
            ]),
        ).toBeDefined()
        expect(() =>
            parse('collect', [{ ...file, absolutePath: null }]),
        ).toThrow()
        expect(
            parse('copy', { archiveSize: 10, checksumSha256: 'b'.repeat(64) }),
        ).toBeDefined()
        expect(() =>
            parse('copy', {
                archiveSize: Number.MAX_SAFE_INTEGER + 1,
                checksumSha256: 'b'.repeat(64),
            }),
        ).toThrow()
        expect(parse('processTar', manifest)).toEqual(manifest)
    })
    it('requires safe bounded background paths and string identities', () => {
        const entry = {
            absolutePath: absolute,
            publicRelativePath: 'images/user/alice/background.webp',
            privateRelativePath: 'backgrounds/alice/background.webp',
            size: 10,
            identity: { dev: '1', ino: '2' },
        }
        expect(parse('backgroundCollect', [entry])).toEqual([entry])
        expect(() =>
            parse('backgroundCollect', [
                { ...entry, privateRelativePath: '../outside' },
            ]),
        ).toThrow()
        expect(() =>
            parse('backgroundCollect', [
                { ...entry, absolutePath: 'relative' },
            ]),
        ).toThrow()
        expect(() =>
            parse('backgroundCollect', [
                { ...entry, identity: { dev: 1, ino: 2 } },
            ]),
        ).toThrow()
        expect(
            parse('backgroundPartition', {
                restoredStoragePath: absolute,
                relativeFilePaths: [entry.privateRelativePath],
            }),
        ).toBeDefined()
        expect(() =>
            parse('backgroundPartition', {
                restoredStoragePath: absolute,
                relativeFilePaths: ['/outside'],
            }),
        ).toThrow()
        expect(() =>
            parse('backgroundPartition', {
                restoredStoragePath: absolute,
                relativeFilePaths: ['C:\\outside'],
            }),
        ).toThrow()
    })
    it('checks acquisition tokens and void operation replies without accepting unknown operations', () => {
        const lease = { token: 'a'.repeat(64) }
        expect(archiveAdmissionSchema.parse(lease)).toEqual(lease)
        expect(() =>
            archiveAdmissionSchema.parse({ token: 'invalid' }),
        ).toThrow()
        expect(parse('admissionAcquire', lease)).toEqual(lease)
        for (const operation of [
            'admissionReserve',
            'admissionRelease',
            'admissionMarkIncomplete',
            'validateKey',
            'backgroundAssertRoots',
        ]) {
            expect(parse(operation, null)).toBeNull()
            expect(() => parse(operation, {})).toThrow()
        }
        expect(() => parse('constructor', {})).toThrow()
        expect(() => parse(undefined, null)).toThrow()
    })
})
