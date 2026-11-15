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
const supportsLinuxWrite = vi.fn(() => false)
vi.mock('@/config/private-storage.config.ts', () => ({
    PRIVATE_STORAGE_WRITE: { directMinimumBytes: 2 },
}))
const writeDirectly = vi.fn(async () => undefined)
vi.mock('@/server/Storage/linux-private-write.service.ts', () => ({
    isLinuxPrivateStorageWriteSupportedService: supportsLinuxWrite,
}))
vi.mock('@/server/Storage/private-write-queue.service.ts', () => ({
    runPrivateStorageWriteService: writeDirectly,
}))
import {
    preparePrivateStorageDirectoryService,
    writePrivateStorageFileService,
} from '@/server/Storage/private-files.service.ts'
import {
    preparePrivateStorageDirectoriesService,
    assertPrivateStorageDirectoriesUnchangedService,
} from '@/server/Storage/private-paths.service.ts'

beforeEach(function () {
    command.mockReset()
    supportsLinuxWrite.mockReturnValue(false)
    writeDirectly.mockReset()
})

describe('private storage native contract', function () {
    it('behält kleine Dateien auch unter Linux auf dem schnelleren Core-Pfad', async function () {
        supportsLinuxWrite.mockReturnValue(true)
        const input = {
            rootDirectory: '/synthetic/private',
            filePath: '/synthetic/private/image.webp',
            data: new Uint8Array([1]),
        }
        await writePrivateStorageFileService(input)
        expect(writeDirectly).not.toHaveBeenCalled()
        expect(command).toHaveBeenCalledWith(
            'storage',
            {
                operation: 'writeFile',
                rootDirectory: input.rootDirectory,
                filePath: input.filePath,
            },
            { binaryInput: input.data },
        )
    })
    it('schreibt unter unterstütztem Linux direkt und reicht Fehler ohne Core-Wiederholung weiter', async function () {
        supportsLinuxWrite.mockReturnValue(true)
        const input = {
            rootDirectory: '/synthetic/private',
            filePath: '/synthetic/private/image.webp',
            data: new Uint8Array([1, 2, 3]),
        }
        await writePrivateStorageFileService(input)
        expect(writeDirectly).toHaveBeenCalledWith(input)
        expect(command).not.toHaveBeenCalled()
        writeDirectly.mockRejectedValueOnce(new Error('write failed'))
        await expect(writePrivateStorageFileService(input)).rejects.toThrow(
            'write failed',
        )
        expect(command).not.toHaveBeenCalled()
    })
    it('prüft die strikten Verzeichnis- und Identitätsantworten zur Laufzeit', async function () {
        const directory = path.resolve('/synthetic/private')
        command.mockResolvedValue([
            { path: directory, identity: { dev: '1', ino: '2' } },
        ])
        await preparePrivateStorageDirectoriesService(directory, directory)
        const validate = command.mock.calls[0]?.[2]?.validateResult
        if (!validate) throw new Error('Missing result validator')
        expect(
            validate([{ path: directory, identity: { dev: '1', ino: '2' } }]),
        ).toEqual([{ path: directory, identity: { dev: '1', ino: '2' } }])
        for (const result of [
            [],
            [{ path: directory, identity: { dev: 1, ino: '2' } }],
            [{ path: directory, identity: { dev: '1', ino: '0' } }],
            [
                {
                    path: directory,
                    identity: { dev: '1', ino: '18446744073709551616' },
                },
            ],
            [{ path: directory, identity: { dev: '1', ino: '02' } }],
            [
                {
                    path: directory,
                    identity: { dev: '1', ino: '2' },
                    extra: true,
                },
            ],
            [
                {
                    path: path.resolve('/outside'),
                    identity: { dev: '1', ino: '2' },
                },
            ],
        ]) {
            expect(function () {
                validate(result)
            }).toThrow()
        }
    })
    it('erhält große Dateisystem-Identitäten ohne Zahlenrundung über die Prozessgrenze', async function () {
        command.mockResolvedValue([
            {
                path: '/synthetic/private',
                identity: { dev: '1', ino: '9007199254740993' },
            },
        ])
        const directories = await preparePrivateStorageDirectoriesService(
            '/synthetic/private',
            '/synthetic/private',
        )
        expect(directories[0]?.identity.ino).toBe(9007199254740993n)
        await assertPrivateStorageDirectoriesUnchangedService(directories)
        expect(command.mock.calls[1]?.[1]).toEqual({
            operation: 'assertDirectories',
            directories: [
                {
                    path: '/synthetic/private',
                    identity: { dev: '1', ino: '9007199254740993' },
                },
            ],
        })
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
