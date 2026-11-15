import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import * as fileSystem from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { existsSync, renameSync, symlinkSync } from 'node:fs'
import * as crypto from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    isLinuxPrivateStorageWriteSupportedService,
    writeLinuxPrivateStorageFileService,
} from '@/server/Storage/linux-private-write.service.ts'

const actualFs = { ...fileSystem }

function interceptPayloadWrite(
    intercept: (
        perform: (
            limit?: number,
        ) => Promise<{ bytesWritten: number; buffer: Uint8Array }>,
        input: {
            buffer: Uint8Array
            offset: number
            length: number
            position: number | null
        },
    ) => Promise<{ bytesWritten: number; buffer: Uint8Array }>,
) {
    const calls = vi.fn(intercept)
    const handles = captureHandles((handle, openArgs) => {
        if (!path.basename(String(openArgs[0])).startsWith('.private-file-'))
            return
        const originalWrite = handle.write.bind(handle)
        // The intercepted descriptor is used only with the validated binary overload.
        const replacement = ((...args: unknown[]) => {
            const [buffer, offset, length, position] = args
            if (
                !(buffer instanceof Uint8Array) ||
                typeof offset !== 'number' ||
                typeof length !== 'number' ||
                (position !== null && typeof position !== 'number')
            )
                throw new Error('Unexpected payload write overload')
            return calls(
                (limit = length) =>
                    originalWrite(
                        buffer,
                        offset,
                        Math.min(limit, length),
                        position,
                    ),
                { buffer, offset, length, position },
            )
        }) as FileHandle['write']
        vi.spyOn(handle, 'write').mockImplementation(replacement)
    })
    return { handles, calls }
}

function captureHandles(
    intercept?: (
        handle: Awaited<ReturnType<typeof fileSystem.open>>,
        args: Parameters<typeof fileSystem.open>,
    ) => void,
) {
    const handles: Awaited<ReturnType<typeof fileSystem.open>>[] = []
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
        const handle = await actualFs.open(...args)
        handles.push(handle)
        intercept?.(handle, args)
        return handle
    })
    return handles
}

async function assertHandlesClosed(
    handles: Awaited<ReturnType<typeof fileSystem.open>>[],
) {
    expect(handles.length).toBeGreaterThan(0)
    await Promise.all(
        handles.map((handle) =>
            expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' }),
        ),
    )
}

async function assertDirectoryModes(directories: string[]) {
    const stats = await Promise.all(
        directories.map((directory) => actualFs.stat(directory)),
    )
    for (const directory of stats) expect(directory.mode & 0o7777).toBe(0o700)
}

describe.skipIf(process.platform !== 'linux')(
    'Linux private write capabilities',
    () => {
        let temporaryDirectory = ''
        let rootDirectory = ''
        let parentDirectory = ''
        let filePath = ''
        let outsideDirectory = ''

        beforeEach(async () => {
            temporaryDirectory = await actualFs.mkdtemp(
                path.join(tmpdir(), 'linux-private-write-test-'),
            )
            rootDirectory = path.join(temporaryDirectory, 'private')
            parentDirectory = path.join(rootDirectory, 'images')
            filePath = path.join(parentDirectory, 'background.bin')
            outsideDirectory = path.join(temporaryDirectory, 'outside')
            await actualFs.mkdir(parentDirectory, {
                recursive: true,
                mode: 0o700,
            })
            await actualFs.mkdir(outsideDirectory, { mode: 0o700 })
        })

        afterEach(async () => {
            vi.restoreAllMocks()
            const resolved = path.resolve(temporaryDirectory)
            if (
                path.dirname(resolved) !== path.resolve(tmpdir()) ||
                !path.basename(resolved).startsWith('linux-private-write-test-')
            )
                throw new Error('Unsichere synthetische Testablage.')
            // Failed mode-000 recovery must not prevent fixture cleanup. Never follow links.
            async function repairOwnedDirectory(
                directory: string,
            ): Promise<void> {
                await actualFs.chmod(directory, 0o700)
                const entries = await actualFs.readdir(directory, {
                    withFileTypes: true,
                })
                await Promise.all(
                    entries
                        .filter((entry) => entry.isDirectory())
                        .map((entry) =>
                            repairOwnedDirectory(
                                path.join(directory, entry.name),
                            ),
                        ),
                )
            }
            await repairOwnedDirectory(resolved)
            await actualFs.rm(resolved, { recursive: true, force: true })
        })

        function write(
            data = new Uint8Array([0, 1, 127, 128, 255]),
            check = () => {},
        ) {
            return writeLinuxPrivateStorageFileService(
                { rootDirectory, filePath, data },
                check,
            )
        }

        async function assertNoTemporaryFiles(directory = parentDirectory) {
            expect(
                (await actualFs.readdir(directory)).filter((name) =>
                    name.startsWith('.private-file-'),
                ),
            ).toEqual([])
        }

        it('enables the adapter on supported Linux architectures', () => {
            expect(isLinuxPrivateStorageWriteSupportedService()).toBe(true)
        })

        it.each([0, 64 * 1024, 8 * 1024 * 1024])(
            'writes %s binary bytes with private modes and closes every handle',
            async (size) => {
                const bytes = Uint8Array.from(
                    { length: size },
                    (_, index) => index % 251,
                )
                const handles = captureHandles()
                expect(await write(bytes)).toBe(true)
                expect(await actualFs.readFile(filePath)).toEqual(
                    Buffer.from(bytes),
                )
                await assertDirectoryModes([rootDirectory, parentDirectory])
                expect((await actualFs.stat(filePath)).mode & 0o7777).toBe(
                    0o600,
                )
                await assertNoTemporaryFiles()
                await assertHandlesClosed(handles)
            },
        )

        it('replaces an existing inode only when the complete new file is published', async () => {
            await actualFs.writeFile(filePath, 'old-private-content', {
                mode: 0o600,
            })
            const before = await actualFs.stat(filePath, { bigint: true })
            interceptPayloadWrite(async (perform) => {
                expect(await actualFs.readFile(filePath, 'utf8')).toBe(
                    'old-private-content',
                )
                const written = await perform()
                expect(await actualFs.readFile(filePath, 'utf8')).toBe(
                    'old-private-content',
                )
                return written
            })
            const bytes = new Uint8Array([255, 0, 19])
            expect(await write(bytes)).toBe(true)
            const after = await actualFs.stat(filePath, { bigint: true })
            expect(after.ino).not.toBe(before.ino)
            expect(await actualFs.readFile(filePath)).toEqual(
                Buffer.from(bytes),
            )
            await assertNoTemporaryFiles()
        })

        it.each(['root', 'nested', 'both'])(
            'repairs owned mode-000 directories before writing: %s',
            async (target) => {
                if (target === 'nested' || target === 'both')
                    await actualFs.chmod(parentDirectory, 0)
                if (target === 'root' || target === 'both')
                    await actualFs.chmod(rootDirectory, 0)
                expect(await write()).toBe(true)
                expect((await actualFs.stat(rootDirectory)).mode & 0o7777).toBe(
                    0o700,
                )
                expect(
                    (await actualFs.stat(parentDirectory)).mode & 0o7777,
                ).toBe(0o700)
                expect((await actualFs.stat(filePath)).mode & 0o7777).toBe(
                    0o600,
                )
            },
        )

        it('repairs a mode-000 root when the target is directly below it', async () => {
            filePath = path.join(rootDirectory, 'direct.bin')
            await actualFs.chmod(rootDirectory, 0)
            expect(await write()).toBe(true)
            expect((await actualFs.stat(rootDirectory)).mode & 0o7777).toBe(
                0o700,
            )
            expect(await actualFs.readFile(filePath)).toEqual(
                Buffer.from([0, 1, 127, 128, 255]),
            )
        })

        it('creates missing private directory components with mode 0700', async () => {
            rootDirectory = path.join(temporaryDirectory, 'new-root')
            parentDirectory = path.join(rootDirectory, 'nested', 'images')
            filePath = path.join(parentDirectory, 'background.bin')
            expect(await write()).toBe(true)
            await assertDirectoryModes([
                rootDirectory,
                path.dirname(parentDirectory),
                parentDirectory,
            ])
        })

        it.each([
            'oversize',
            'escape',
            'root-target',
            'nul-root',
            'nul-target',
        ])(
            'rejects invalid input before opening the destination: %s',
            async (invalid) => {
                const open = vi.spyOn(fileSystem, 'open')
                const data =
                    invalid === 'oversize'
                        ? new Uint8Array(8 * 1024 * 1024 + 1)
                        : new Uint8Array([1])
                if (invalid === 'escape')
                    filePath = path.join(
                        rootDirectory,
                        '..',
                        'outside',
                        'escape.bin',
                    )
                if (invalid === 'root-target') filePath = rootDirectory
                if (invalid === 'nul-root') rootDirectory += '\0injected'
                if (invalid === 'nul-target') filePath += '\0injected'
                await expect(write(data)).rejects.toThrow()
                expect(open).not.toHaveBeenCalled()
                expect(await actualFs.readdir(outsideDirectory)).toEqual([])
            },
        )

        it.each(['root', 'parent', 'absolute-prefix'])(
            'rejects a symlinked %s without modifying its referent',
            async (target) => {
                const sentinel = path.join(outsideDirectory, 'sentinel')
                await actualFs.writeFile(sentinel, 'outside-sentinel', {
                    mode: 0o644,
                })
                if (target === 'root') {
                    await actualFs.rm(rootDirectory, { recursive: true })
                    await actualFs.symlink(
                        outsideDirectory,
                        rootDirectory,
                        'dir',
                    )
                } else if (target === 'parent') {
                    await actualFs.rmdir(parentDirectory)
                    await actualFs.symlink(
                        outsideDirectory,
                        parentDirectory,
                        'dir',
                    )
                } else {
                    const alias = path.join(temporaryDirectory, 'alias')
                    await actualFs.symlink(temporaryDirectory, alias, 'dir')
                    rootDirectory = path.join(alias, 'private')
                    parentDirectory = path.join(rootDirectory, 'images')
                    filePath = path.join(parentDirectory, 'background.bin')
                }
                await expect(write()).rejects.toThrow()
                expect(await actualFs.readFile(sentinel, 'utf8')).toBe(
                    'outside-sentinel',
                )
                expect((await actualFs.stat(sentinel)).mode & 0o7777).toBe(
                    0o644,
                )
                expect(await actualFs.readdir(outsideDirectory)).toEqual([
                    'sentinel',
                ])
            },
        )

        it('replaces a symlink target leaf without following it', async () => {
            const referent = path.join(outsideDirectory, 'outside-file')
            await actualFs.writeFile(referent, 'outside-sentinel', {
                mode: 0o644,
            })
            await actualFs.symlink(referent, filePath)
            expect(await write()).toBe(true)
            expect((await actualFs.lstat(filePath)).isSymbolicLink()).toBe(
                false,
            )
            expect(await actualFs.readFile(referent, 'utf8')).toBe(
                'outside-sentinel',
            )
            expect((await actualFs.stat(referent)).mode & 0o7777).toBe(0o644)
        })

        it.each(['root', 'parent'])(
            'rejects a replaced %s before the payload write',
            async (target) => {
                const exchanged =
                    target === 'root' ? rootDirectory : parentDirectory
                const moved = path.join(temporaryDirectory, 'displaced')
                const { handles, calls: payloadWrite } = interceptPayloadWrite(
                    (perform) => perform(),
                )
                let checks = 0
                await expect(
                    write(new Uint8Array([1]), () => {
                        checks += 1
                        if (checks === 2) {
                            renameSync(exchanged, moved)
                            symlinkSync(outsideDirectory, exchanged, 'dir')
                        }
                    }),
                ).rejects.toThrow()
                expect(checks).toBe(2)
                expect(payloadWrite).not.toHaveBeenCalled()
                expect(await actualFs.readdir(outsideDirectory)).toEqual([])
                await assertHandlesClosed(handles)
            },
        )

        it.each(['root', 'parent'])(
            'rejects an exchanged %s after writing and leaves the outside tree untouched',
            async (target) => {
                const exchanged =
                    target === 'root' ? rootDirectory : parentDirectory
                const moved = path.join(temporaryDirectory, 'displaced')
                const { handles } = interceptPayloadWrite(async (perform) => {
                    const written = await perform()
                    await actualFs.rename(exchanged, moved)
                    await actualFs.symlink(outsideDirectory, exchanged, 'dir')
                    return written
                })
                await expect(write()).rejects.toThrow()
                expect(await actualFs.readdir(outsideDirectory)).toEqual([])
                expect(existsSync(path.join(moved, 'background.bin'))).toBe(
                    false,
                )
                await assertHandlesClosed(handles)
            },
        )

        it('writes through its pinned file when its parent is exchanged during the descriptor write', async () => {
            const moved = path.join(temporaryDirectory, 'displaced')
            interceptPayloadWrite(async (perform) => {
                await actualFs.rename(parentDirectory, moved)
                await actualFs.symlink(outsideDirectory, parentDirectory, 'dir')
                return perform()
            })
            await expect(write()).rejects.toThrow()
            expect(await actualFs.readdir(outsideDirectory)).toEqual([])
            const temporary = (await actualFs.readdir(moved)).find((name) =>
                name.startsWith('.private-file-'),
            )
            expect(temporary).toBeDefined()
            if (!temporary)
                throw new Error('Missing displaced owned temporary file')
            expect(
                await actualFs.readFile(path.join(moved, temporary)),
            ).toEqual(Buffer.from([0, 1, 127, 128, 255]))
        })

        it('publishes only into its pinned parent if its name changes immediately before rename', async () => {
            const moved = path.join(temporaryDirectory, 'displaced')
            vi.spyOn(fileSystem, 'rename').mockImplementationOnce(
                async (...args) => {
                    await actualFs.rename(parentDirectory, moved)
                    await actualFs.symlink(
                        outsideDirectory,
                        parentDirectory,
                        'dir',
                    )
                    return actualFs.rename(...args)
                },
            )
            expect(await write()).toBe(true)
            expect(await actualFs.readdir(outsideDirectory)).toEqual([])
            expect(
                await actualFs.readFile(path.join(moved, 'background.bin')),
            ).toEqual(Buffer.from([0, 1, 127, 128, 255]))
            await assertNoTemporaryFiles(moved)
        })

        it('keeps a foreign replacement of the temporary name during failed cleanup', async () => {
            let replacement = ''
            interceptPayloadWrite(async (perform) => {
                await perform()
                const temporary = (
                    await actualFs.readdir(parentDirectory)
                ).find((name) => name.startsWith('.private-file-'))
                if (!temporary) throw new Error('Missing owned temporary file')
                replacement = path.join(parentDirectory, temporary)
                await actualFs.rename(
                    replacement,
                    path.join(temporaryDirectory, 'owned-displaced'),
                )
                await actualFs.writeFile(
                    replacement,
                    'foreign-temp-replacement',
                    { mode: 0o600 },
                )
                throw new Error('Synthetic write failure after replacement')
            })
            await expect(write()).rejects.toThrow()
            expect(await actualFs.readFile(replacement, 'utf8')).toBe(
                'foreign-temp-replacement',
            )
            expect(existsSync(filePath)).toBe(false)
        })

        it('cleans its own temporary file and closes capabilities after a write failure', async () => {
            const { handles } = interceptPayloadWrite(async () => {
                throw new Error('Synthetic write failure')
            })
            await expect(write()).rejects.toThrow()
            expect(existsSync(filePath)).toBe(false)
            await assertNoTemporaryFiles()
            await assertHandlesClosed(handles)
        })

        it('does not overwrite or clean up a colliding existing temporary file', async () => {
            const identifier = '00000000-0000-4000-8000-000000000000'
            vi.spyOn(crypto, 'randomUUID').mockReturnValue(identifier)
            const collision = path.join(
                parentDirectory,
                `.private-file-${identifier}.tmp`,
            )
            await actualFs.writeFile(collision, 'foreign-collision', {
                mode: 0o600,
            })
            const handles = captureHandles()
            await expect(write()).rejects.toMatchObject({ code: 'EEXIST' })
            expect(await actualFs.readFile(collision, 'utf8')).toBe(
                'foreign-collision',
            )
            expect(existsSync(filePath)).toBe(false)
            await assertHandlesClosed(handles)
        })

        it('exposes a safe error code without leaking private paths or underlying messages', async () => {
            interceptPayloadWrite(async () => {
                throw Object.assign(
                    new Error(`Synthetic private content at ${filePath}`),
                    { code: 'EACCES' },
                )
            })
            await expect(write()).rejects.toMatchObject({
                code: 'EACCES',
                message: 'Private storage operation failed.',
            })
            await assertNoTemporaryFiles()
        })

        it('finishes actual short descriptor writes using advancing offsets and the same buffer', async () => {
            await actualFs.writeFile(filePath, 'old-private-content', {
                mode: 0o600,
            })
            const bytes = new Uint8Array([1, 2, 3, 4, 5])
            const offsets: number[] = []
            const lengths: number[] = []
            const checksAtWrite: number[] = []
            let checks = 0
            const { handles, calls } = interceptPayloadWrite(
                async (perform, input) => {
                    expect(input.buffer).toBe(bytes)
                    expect(input.position).toBe(null)
                    offsets.push(input.offset)
                    lengths.push(input.length)
                    checksAtWrite.push(checks)
                    return perform(3)
                },
            )
            expect(
                await write(bytes, () => {
                    checks += 1
                }),
            ).toBe(true)
            expect(calls).toHaveBeenCalledTimes(2)
            expect(offsets).toEqual([0, 3])
            expect(lengths).toEqual([5, 2])
            expect(checksAtWrite[1]).toBeGreaterThan(checksAtWrite[0] ?? 0)
            expect(await actualFs.readFile(filePath)).toEqual(
                Buffer.from(bytes),
            )
            await assertNoTemporaryFiles()
            await assertHandlesClosed(handles)
        })

        it.each([0, Number.NaN, 4])(
            'rejects invalid descriptor write progress %s without publishing',
            async (bytesWritten) => {
                await actualFs.writeFile(filePath, 'old-private-content', {
                    mode: 0o600,
                })
                const { handles, calls } = interceptPayloadWrite(
                    async (_perform, input) => ({
                        bytesWritten,
                        buffer: input.buffer,
                    }),
                )
                await expect(write(new Uint8Array([1, 2, 3]))).rejects.toThrow()
                expect(calls).toHaveBeenCalledTimes(1)
                expect(await actualFs.readFile(filePath, 'utf8')).toBe(
                    'old-private-content',
                )
                await assertNoTemporaryFiles()
                await assertHandlesClosed(handles)
            },
        )

        it('refuses to publish a replaced temporary inode even after a successful payload write', async () => {
            let replacement = ''
            interceptPayloadWrite(async (perform) => {
                const written = await perform()
                const temporary = (
                    await actualFs.readdir(parentDirectory)
                ).find((name) => name.startsWith('.private-file-'))
                if (!temporary) throw new Error('Missing owned temporary file')
                replacement = path.join(parentDirectory, temporary)
                await actualFs.rename(
                    replacement,
                    path.join(temporaryDirectory, 'owned-displaced'),
                )
                await actualFs.writeFile(
                    replacement,
                    'foreign-temp-replacement',
                    { mode: 0o600 },
                )
                return written
            })
            await expect(write()).rejects.toThrow()
            expect(await actualFs.readFile(replacement, 'utf8')).toBe(
                'foreign-temp-replacement',
            )
            expect(existsSync(filePath)).toBe(false)
        })

        it.each(['file-sync', 'directory-sync'])(
            'fails closed after %s failure and closes every descriptor',
            async (failure) => {
                const bytes = new Uint8Array([5, 6, 7])
                const handles = captureHandles((handle, args) => {
                    const descriptorPath = String(args[0])
                    const temporary = path
                        .basename(descriptorPath)
                        .startsWith('.private-file-')
                    const syncDirectory = descriptorPath.endsWith('/.')
                    if (
                        (failure === 'file-sync' && temporary) ||
                        (failure === 'directory-sync' && syncDirectory)
                    )
                        vi.spyOn(handle, 'sync').mockRejectedValueOnce(
                            new Error('Synthetic sync failure'),
                        )
                })
                await expect(write(bytes)).rejects.toThrow()
                if (failure === 'directory-sync')
                    expect(await actualFs.readFile(filePath)).toEqual(
                        Buffer.from(bytes),
                    )
                else expect(existsSync(filePath)).toBe(false)
                await assertNoTemporaryFiles()
                await assertHandlesClosed(handles)
            },
        )

        it('preserves the previous file when rename fails', async () => {
            await actualFs.writeFile(filePath, 'old-private-content', {
                mode: 0o600,
            })
            const handles = captureHandles()
            vi.spyOn(fileSystem, 'rename').mockRejectedValueOnce(
                new Error('Synthetic rename failure'),
            )
            await expect(write()).rejects.toThrow()
            expect(await actualFs.readFile(filePath, 'utf8')).toBe(
                'old-private-content',
            )
            await assertNoTemporaryFiles()
            await assertHandlesClosed(handles)
        })

        it('does not publish after cancellation following the completed write', async () => {
            await actualFs.writeFile(filePath, 'old-private-content', {
                mode: 0o600,
            })
            let written = false
            const { handles } = interceptPayloadWrite(async (perform) => {
                const result = await perform()
                written = true
                return result
            })
            const cancelled = new Error('Synthetic cancelled private write')
            await expect(
                write(new Uint8Array([1, 2]), () => {
                    if (written) throw cancelled
                }),
            ).rejects.toThrow()
            expect(await actualFs.readFile(filePath, 'utf8')).toBe(
                'old-private-content',
            )
            await assertNoTemporaryFiles()
            await assertHandlesClosed(handles)
        })

        it('drains a sibling identity check before failed validation closes capabilities or starts cleanup', async () => {
            const sibling = Promise.withResolvers<void>()
            const siblingOpened = Promise.withResolvers<void>()
            const failedCheckClosed = Promise.withResolvers<void>()
            const handles: Awaited<ReturnType<typeof fileSystem.open>>[] = []
            const walks = new Map<number, number>()
            let root: Awaited<ReturnType<typeof fileSystem.open>> | undefined
            let parent: Awaited<ReturnType<typeof fileSystem.open>> | undefined
            let validating = false
            let walkSequence = 0
            let ownedClosed = false
            let cleanupStarted = false
            let returned = false
            const unlink = vi.spyOn(fileSystem, 'unlink')
            vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
                const source = String(args[0])
                const predecessor = /^\/proc\/self\/fd\/(\d+)\//.exec(source)
                const walk = validating
                    ? source === '/'
                        ? ++walkSequence
                        : (walks.get(Number(predecessor?.[1])) ?? 0)
                    : 0
                if (walk > 2) cleanupStarted = true
                const handle = await actualFs.open(...args)
                handles.push(handle)
                walks.set(handle.fd, walk)
                const name = path.basename(source)
                if (!validating && name === 'private') root = handle
                if (!validating && name === 'images') parent = handle
                if (walk === 2 && name === 'images') siblingOpened.resolve()
                const close = handle.close.bind(handle)
                vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
                    if (handle === root || handle === parent) ownedClosed = true
                    await close()
                    if (walk === 1 && name === 'private')
                        failedCheckClosed.resolve()
                })
                return handle
            })
            let checks = 0
            const result = write(new Uint8Array([1, 2, 3]), () => {
                if (++checks !== 2) return
                if (!root || !parent)
                    throw new Error('Missing held directory capabilities')
                validating = true
                vi.spyOn(root, 'stat').mockRejectedValueOnce(
                    new Error('Synthetic root identity failure'),
                )
                const stat = parent.stat.bind(parent)
                vi.spyOn(parent, 'stat').mockReturnValueOnce(
                    sibling.promise.then(() => stat({ bigint: true })),
                )
            }).then(
                () => {
                    returned = true
                    return undefined
                },
                (error: unknown) => {
                    returned = true
                    return error
                },
            )
            try {
                await Promise.all([
                    siblingOpened.promise,
                    failedCheckClosed.promise,
                ])
                // Drain ready continuations without advancing a clock or releasing I/O.
                await new Promise<void>((resolve) => setImmediate(resolve))
                if (!parent) throw new Error('Missing held parent capability')
                expect(parent.stat).toHaveBeenCalledTimes(1)
                expect(returned).toBe(false)
                expect(ownedClosed).toBe(false)
                expect(cleanupStarted).toBe(false)
                expect(unlink).not.toHaveBeenCalled()
                expect(existsSync(filePath)).toBe(false)
            } finally {
                sibling.resolve()
                await result
            }
            expect(await result).toBeInstanceOf(Error)
            expect(returned).toBe(true)
            expect(ownedClosed).toBe(true)
            await assertNoTemporaryFiles()
            await assertHandlesClosed(handles)
        })

        it('does not create a temporary file when already cancelled', async () => {
            const cancelled = new Error('Synthetic initial cancellation')
            await expect(
                write(new Uint8Array([1]), () => {
                    throw cancelled
                }),
            ).rejects.toThrow()
            expect(await actualFs.readdir(parentDirectory)).toEqual([])
        })

        it.each(['unavailable', 'wrong-type'])(
            'returns unsupported for %s procfs before permission repairs or creation',
            async (failure) => {
                await actualFs.chmod(rootDirectory, 0o755)
                filePath = path.join(rootDirectory, 'missing', 'new.bin')
                const chmod = vi.spyOn(fileSystem, 'chmod')
                const mkdir = vi.spyOn(fileSystem, 'mkdir')
                if (failure === 'unavailable')
                    vi.spyOn(fileSystem, 'statfs').mockRejectedValueOnce(
                        Object.assign(new Error('Synthetic absent procfs'), {
                            code: 'ENOENT',
                        }),
                    )
                else {
                    const filesystem = await actualFs.statfs('/proc/self/fd')
                    vi.spyOn(fileSystem, 'statfs').mockResolvedValueOnce({
                        ...filesystem,
                        type: 0,
                    })
                }
                expect(await write()).toBe(false)
                expect(chmod).not.toHaveBeenCalled()
                expect(mkdir).not.toHaveBeenCalled()
                expect((await actualFs.stat(rootDirectory)).mode & 0o7777).toBe(
                    0o755,
                )
                expect(existsSync(path.dirname(filePath))).toBe(false)
            },
        )
    },
)
