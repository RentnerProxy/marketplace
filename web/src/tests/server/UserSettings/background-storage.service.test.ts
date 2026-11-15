import { beforeEach, describe, expect, it, vi } from 'bun:test'
import path from 'node:path'
import type { CoreCommandOptions } from '@/server/Core/Types/core.types.ts'

const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: CoreCommandOptions,
): Promise<Buffer | null> {
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
import { readCurrentUserBackgroundFileService } from '@/server/UserSettings/background-storage.service.ts'

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
        expect(validate(bytes)).toBe(bytes)
        expect(validate(Buffer.alloc(0))).toEqual(Buffer.alloc(0))
        expect(validate(Buffer.alloc(8 * 1024 * 1024))).toHaveLength(
            8 * 1024 * 1024,
        )
        for (const result of [
            new Uint8Array([1, 2, 3]),
            'AQID',
            undefined,
            { dataBase64: 3 },
            { dataBase64: '%%%secret' },
            { dataBase64: 'AQI' },
            { dataBase64: 'AQID', extra: true },
            Buffer.alloc(8 * 1024 * 1024 + 1),
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
        expect(request?.operation).toBe('readBackgroundBytes')
        expect(String(request?.filePath)).toContain('private')
        expect(String(request?.legacyPath)).toContain('public')
    })

    it('reicht die bestätigten Dateibytes ohne Base64 oder erneute Kopie weiter', async function () {
        const data = Buffer.from('synthetic-image')
        command.mockResolvedValue(data)
        expect(await readCurrentUserBackgroundFileService('id')).toBe(data)
    })

    it('gibt fehlgeschlagene native Prüfungen weiter', async function () {
        command.mockRejectedValue(new Error('synthetic ownership failure'))
        await expect(
            readCurrentUserBackgroundFileService('id'),
        ).rejects.toThrow('synthetic ownership failure')
    })
})
