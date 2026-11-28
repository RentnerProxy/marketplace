import { beforeEach, describe, expect, it, vi } from 'bun:test'
import path from 'node:path'
import type { CoreCommandOptions } from '@/server/Core/Types/core.types.ts'

const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: CoreCommandOptions,
): Promise<unknown> {
    return undefined
})
vi.mock('@/server/Core/command.service.ts', function () {
    return { runCoreCommandService: command }
})
import {
    preparePrivateStorageDirectoryService,
    writePrivateStorageFileService,
} from '@/server/Storage/private-files.service.ts'
import {
    nativeStorageAbsolutePathSchema,
    nativeStorageIdentitySchema,
} from '@/server/Storage/private-paths.service.ts'

beforeEach(function () {
    command.mockReset()
})

describe('private storage native contract', function () {
    it('propagates storage failures without resubmitting the write', async function () {
        const input = {
            rootDirectory: '/synthetic/private',
            filePath: '/synthetic/private/image.webp',
            data: new Uint8Array(512 * 1024),
        }
        command.mockRejectedValueOnce(new Error('write failed'))
        await expect(writePrivateStorageFileService(input)).rejects.toThrow(
            'write failed',
        )
        expect(command).toHaveBeenCalledTimes(1)
    })
    it('validates canonical paths and preserves full-width storage identities', function () {
        const directory = path.resolve('/synthetic/private')
        expect(nativeStorageAbsolutePathSchema.parse(directory)).toBe(directory)
        expect(
            nativeStorageAbsolutePathSchema.safeParse('relative').success,
        ).toBe(false)
        expect(
            nativeStorageAbsolutePathSchema.safeParse(directory + '/..')
                .success,
        ).toBe(false)
        const identity = { dev: '1', ino: '9007199254740993' }
        expect(nativeStorageIdentitySchema.parse(identity)).toEqual(identity)
        for (const result of [
            { dev: 1, ino: '2' },
            { dev: '1', ino: '0' },
            { dev: '1', ino: '18446744073709551616' },
            { dev: '1', ino: '02' },
            { ...identity, extra: true },
        ]) {
            expect(nativeStorageIdentitySchema.safeParse(result).success).toBe(
                false,
            )
        }
    })
    it('übergibt private Dateidaten begrenzt und explizit an den Storage-Core', async function () {
        await writePrivateStorageFileService({
            rootDirectory: '/synthetic/private',
            filePath: '/synthetic/private/image.webp',
            data: new Uint8Array([1, 2, 3]),
        })
        expect(command).toHaveBeenCalledWith(
            'storage',
            {
                operation: 'writeFile',
                rootDirectory: '/synthetic/private',
                filePath: '/synthetic/private/image.webp',
            },
            { binaryInput: new Uint8Array([1, 2, 3]) },
        )
    })

    it('verwirft übergroße Eingaben vor dem Prozessstart', async function () {
        await expect(
            writePrivateStorageFileService({
                rootDirectory: '/synthetic/private',
                filePath: '/synthetic/private/image.webp',
                data: new Uint8Array(8 * 1024 * 1024 + 1),
            }),
        ).rejects.toThrow()
        expect(command).not.toHaveBeenCalled()
    })

    it('lässt Verzeichnisse und Rechte vom Core prüfen', async function () {
        await preparePrivateStorageDirectoryService(
            '/synthetic/private',
            '/synthetic/private/images',
        )
        expect(command).toHaveBeenCalledWith('storage', {
            operation: 'prepareDirectories',
            rootDirectory: '/synthetic/private',
            directoryPath: '/synthetic/private/images',
        })
    })
})
