import { beforeEach, describe, expect, it, vi } from 'bun:test'
import path from 'node:path'
import type { CoreCommandOptions } from '@/server/Core/Types/core.types.ts'

const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: CoreCommandOptions,
): Promise<unknown> {
    return null
})
vi.mock('@/server/Core/command.service.ts', function () {
    return { runCoreCommandService: command }
})
vi.mock('@/lib/Images/publicImagePaths.ts', function () {
    return {
        getPublicStorageRoot: function () {
            return path.resolve('synthetic-background-fixture/public')
        },
        getUserPublicImagePaths: function () {
            const base = path.resolve('synthetic-background-fixture')
            return {
                absolutePrivateStorageRoot: path.join(base, 'private'),
                absoluteBackgroundDir: path.join(
                    base,
                    'private/images/user/id',
                ),
                absoluteBackground: path.join(
                    base,
                    'private/images/user/id/background.webp',
                ),
                absoluteDir: path.join(base, 'public/images/user/id'),
                absoluteLegacyBackground: path.join(
                    base,
                    'public/images/user/id/background.webp',
                ),
            }
        },
    }
})
import {
    readCurrentUserBackgroundFileService,
    statCurrentUserBackgroundFileService,
} from '@/server/UserSettings/background-storage.service.ts'

const version = 'a'.repeat(64)

beforeEach(function () {
    command.mockReset()
    command.mockResolvedValue(null)
})

describe('private background native contract', function () {
    it('akzeptiert nur begrenzte binäre Nutzdaten und gibt denselben validierten Buffer zurück', async function () {
        await readCurrentUserBackgroundFileService('id')
        const validate = command.mock.calls[0]?.[2]?.validateResult
        if (!validate) throw new Error('Missing result validator')
        expect(validate(null)).toBeNull()
        const bytes = Buffer.from([0, 10, 255])
        const parsed = validate({ version, bytes }) as { bytes: Buffer }
        expect(parsed.bytes).toBe(bytes)
        expect(validate({ version, bytes: Buffer.alloc(0) })).toEqual({
            version,
            bytes: Buffer.alloc(0),
        })
        const maximum = Buffer.alloc(8 * 1024 * 1024)
        expect(validate({ version, bytes: maximum })).toEqual({
            version,
            bytes: maximum,
        })
        for (const result of [
            new Uint8Array([1, 2, 3]),
            'AQID',
            undefined,
            { dataBase64: 3 },
            { dataBase64: '%%%secret' },
            { dataBase64: 'AQI' },
            { dataBase64: 'AQID', extra: true },
            { version, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) },
            { version: 'invalid', bytes },
            { bytes },
            { version, bytes, extra: true },
        ]) {
            expect(function () {
                validate(result)
            }).toThrow()
        }
    })
    it('bündelt Lesen und Legacy-Migration in einer kontrollierten Core-Operation', async function () {
        expect(await readCurrentUserBackgroundFileService('id')).toBeNull()
        expect(command.mock.calls[0]?.[0]).toBe('storage')
        const request = command.mock.calls[0]?.[1]
        expect(request?.operation).toBe('readBackgroundRepresentation')
        expect(String(request?.filePath)).toContain('private')
        expect(String(request?.legacyPath)).toContain('public')
    })

    it('reicht die bestätigten Dateibytes ohne Base64 oder erneute Kopie weiter', async function () {
        const data = Buffer.from('synthetic-image')
        command.mockResolvedValue({ version, bytes: data })
        const result = await readCurrentUserBackgroundFileService('id')
        expect(result?.bytes).toBe(data)
        expect(result?.size).toBe(data.byteLength)
    })

    it('requests bounded metadata without binary output and accepts only the exact metadata shape', async function () {
        await statCurrentUserBackgroundFileService('id')
        expect(command.mock.calls[0]?.[1]?.operation).toBe('statBackground')
        const validate = command.mock.calls[0]?.[2]?.validateResult
        if (!validate) throw new Error('Missing metadata validator')
        expect(validate(null)).toBeNull()
        const metadata = { version, size: 8 * 1024 * 1024 }
        expect(validate(metadata)).toEqual(metadata)
        for (const invalid of [
            { ...metadata, size: metadata.size + 1 },
            { ...metadata, size: -1 },
            { ...metadata, size: 0.5 },
            { ...metadata, bytes: Buffer.alloc(0) },
            { ...metadata, version: 'a'.repeat(64) + '\n' },
        ]) {
            expect(() => validate(invalid)).toThrow()
        }
    })

    it('gibt fehlgeschlagene native Prüfungen weiter', async function () {
        command.mockRejectedValue(new Error('synthetic ownership failure'))
        await expect(
            readCurrentUserBackgroundFileService('id'),
        ).rejects.toThrow('synthetic ownership failure')
    })
})
