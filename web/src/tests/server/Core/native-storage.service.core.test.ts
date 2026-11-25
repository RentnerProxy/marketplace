import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { getCoreStorageLibraryPaths } from '@/server/Core/binary.service.ts'
import {
    cleanupStorageMutationTestDirectoryService,
    createStorageMutationTestDirectoryService,
} from '../Storage/storageMutationFence.test.helpers.ts'

const pooled = vi.fn(async () => 'pooled')
const warn = vi.fn()
vi.mock('@/server/Core/worker-pool.service.ts', () => ({
    runPooledCoreCommandService: pooled,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logError: vi.fn(),
    logInfo: vi.fn(),
    logWarn: warn,
}))
const { runCoreCommandService: run } =
    await import('@/server/Core/command.service.ts')
const previousMode = process.env.CORE_STORAGE_FFI
const previousBinaryDirectory = process.env.CORE_BINARY_DIR
const hasLibrary =
    previousMode === 'required' ||
    getCoreStorageLibraryPaths().some((filename) => existsSync(filename))

let fixture: Awaited<
    ReturnType<typeof createStorageMutationTestDirectoryService>
>
beforeEach(async () => {
    pooled.mockClear()
    warn.mockClear()
    process.env.CORE_STORAGE_FFI = 'required'
    fixture = await createStorageMutationTestDirectoryService()
})
afterEach(async () => {
    if (previousMode === undefined) delete process.env.CORE_STORAGE_FFI
    else process.env.CORE_STORAGE_FFI = previousMode
    if (previousBinaryDirectory === undefined)
        delete process.env.CORE_BINARY_DIR
    else process.env.CORE_BINARY_DIR = previousBinaryDirectory
    await cleanupStorageMutationTestDirectoryService(fixture)
})

it.skipIf(!hasLibrary)(
    'uses the native library for bounded metadata',
    async () => {
        const { rootDirectory, temporaryDirectory } = fixture
        const filePath = path.join(rootDirectory, 'background.webp')
        const stat = {
            operation: 'statBackground',
            rootDirectory,
            directoryPath: rootDirectory,
            filePath,
        }
        const restore = {
            operation: 'restoreStateGet',
            backupDirectory: rootDirectory,
            storageDirectory: path.join(temporaryDirectory, 'storage'),
        }
        await expect(run('storage', restore)).resolves.toBeNull()
        await expect(run('storage', stat)).resolves.toBeNull()
        expect(existsSync(rootDirectory)).toBe(false)

        await mkdir(rootDirectory, { mode: 0o700 })
        await writeFile(filePath, 'private', { mode: 0o600 })
        await expect(run('storage', stat)).resolves.toEqual({
            size: 7,
            version: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
        await expect(
            run('storage', { operation: 'capacity', requests: [] }),
        ).resolves.toEqual({ ok: true })
        expect(pooled).not.toHaveBeenCalled()
    },
)

it.skipIf(!hasLibrary)(
    'preserves native operation and validation errors',
    async () => {
        await expect(
            run('storage', { operation: 'restoreStateGet' }),
        ).rejects.toMatchObject({ code: 'STORAGE_INVALID', isUncertain: false })
        await expect(
            run(
                'storage',
                { operation: 'capacity', requests: [] },
                {
                    validateResult() {
                        throw new Error('Invalid reply')
                    },
                },
            ),
        ).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
        expect(pooled).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
    },
)

it('warns once for an automatic fallback before executing on the worker', async () => {
    process.env.CORE_BINARY_DIR = fixture.temporaryDirectory
    const request = { operation: 'capacity', requests: [] }
    await expect(run('storage', request)).rejects.toMatchObject({
        code: 'CORE_UNAVAILABLE',
    })
    expect(pooled).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    delete process.env.CORE_STORAGE_FFI
    await expect(run('storage', request)).resolves.toBe('pooled')
    await expect(run('storage', request)).resolves.toBe('pooled')
    expect(pooled).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
        'core.storage_ffi_unavailable_using_worker',
        expect.objectContaining({ service: 'core' }),
    )
})

it('uses the worker without loading the library when FFI is disabled', async () => {
    process.env.CORE_BINARY_DIR = fixture.temporaryDirectory
    process.env.CORE_STORAGE_FFI = 'disabled'
    await expect(
        run('storage', { operation: 'capacity', requests: [] }),
    ).resolves.toBe('pooled')
    expect(warn).not.toHaveBeenCalled()
})

it('keeps mutations, binary work, migration and cancellable reads on workers even with FFI required', async () => {
    process.env.CORE_BINARY_DIR = fixture.temporaryDirectory
    const { rootDirectory, temporaryDirectory } = fixture
    const binaryInput = Uint8Array.of(99, 0, 42, 255, 100).subarray(1, 4)
    const signal = new AbortController().signal
    const capacity = { operation: 'capacity', requests: [] }
    const write = { operation: 'writeFile', rootDirectory }
    const migrate = {
        operation: 'statBackground',
        legacyRoot: temporaryDirectory,
        legacyPath: path.join(temporaryDirectory, 'legacy.webp'),
    }
    const otherWorkerOperations = [
        'backupDeleteFiles',
        'backupPreparePaths',
        'backupPublishFile',
        'fenceAdmitShared',
        'fenceRelease',
        'permissions',
        'prepareDirectories',
        'readBackgroundRepresentation',
        'restoreStateWrite',
        'syncDirectory',
        'tempDirectory',
    ]
    const replies = await Promise.all([
        ...otherWorkerOperations.map((operation) =>
            run('storage', { operation }),
        ),
        run('storage', write, { binaryInput }),
        run('storage', { operation: 'brandingPublish' }, { binaryInput }),
        run('storage', migrate),
        run('storage', { operation: 'statBackground', legacyPath: null }),
        run('storage', capacity, { signal }),
        run('storage', capacity, { timeoutMs: 100 }),
        run('storage', {
            operation: 'capacity',
            requests: [{ sourcePaths: [rootDirectory] }],
        }),
        run('storage', {
            operation: 'capacity',
            requests: Array.from(
                { length: CORE_RUNTIME.storageFfi.maxBatchSize + 1 },
                () => ({ sourcePaths: [] }),
            ),
        }),
    ])
    expect(replies.every((reply) => reply === 'pooled')).toBe(true)
    expect(pooled).toHaveBeenCalledTimes(replies.length)
    expect(pooled).toHaveBeenCalledWith('storage', write, { binaryInput })
    expect(pooled).toHaveBeenCalledWith('storage', capacity, { signal })
    expect(warn).not.toHaveBeenCalled()
})
