import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import * as filesystem from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as core from '@/server/Core/command.service.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import {
    acquireExclusiveStorageMutationFenceService as acquireExclusive,
    admitSharedStorageMutationFenceService as admitShared,
    releaseStorageMutationFenceService as release,
    waitForStorageMutationSharedDrainService as drain,
} from '@/server/Storage/storage-mutation-fence.service.ts'
import {
    StorageMutationAdmissionBusyError,
    StorageMutationFenceUnavailableError,
} from '@/server/Storage/storage-mutation-fence.errors.ts'
import {
    cleanupStorageMutationTestDirectoryService,
    createStorageMutationTestDirectoryService,
} from './storageMutationFence.test.helpers.ts'
import type { StorageMutationTestDirectory } from './storageMutationFence.test.types.ts'

let fixture: StorageMutationTestDirectory
beforeEach(async function () {
    fixture = await createStorageMutationTestDirectoryService()
})
afterEach(async function () {
    vi.restoreAllMocks()
    await cleanupStorageMutationTestDirectoryService(fixture)
})
function gatePath() {
    return path.join(fixture.rootDirectory, config.admissionDirectoryName)
}
function wire(value: unknown): unknown {
    return JSON.parse(
        JSON.stringify(value, (_key, entry: unknown) =>
            typeof entry === 'bigint' ? String(entry) : entry,
        ),
    )
}
function mockResult(value: unknown) {
    return vi
        .spyOn(core, 'runCoreCommandService')
        .mockImplementation(async function (
            ...args: Parameters<typeof core.runCoreCommandService>
        ) {
            return args[2]?.validateResult
                ? args[2].validateResult(value)
                : value
        })
}

async function runIsolatedControlProcess(script: string) {
    const child = Bun.spawn(
        [process.execPath, '--no-env-file', '--eval', script],
        {
            cwd: process.cwd(),
            env: {
                CORE_BINARY_DIR: process.env.CORE_BINARY_DIR,
                SystemRoot: process.env.SystemRoot,
                WINDIR: process.env.WINDIR,
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        child.kill()
    }, 5_000)
    try {
        const [exitCode, output, errorOutput] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect(timedOut).toBe(false)
        expect(exitCode).toBe(0)
        expect(errorOutput.length).toBe(0)
        const result: string[] = []
        for (const line of output.split(/\r?\n/).filter(Boolean)) {
            if (!line.startsWith('{')) {
                result.push(line)
                continue
            }
            const entry: unknown = JSON.parse(line)
            expect(entry).toMatchObject({ service: 'core', level: 'info' })
            expect(entry).toHaveProperty('event')
            if (
                typeof entry !== 'object' ||
                entry === null ||
                !('event' in entry) ||
                typeof entry.event !== 'string'
            )
                throw new Error('Missing core event')
            expect([
                'core.storage_started',
                'core.storage_completed',
            ]).toContain(entry.event)
        }
        return result.join('\n')
    } finally {
        clearTimeout(timer)
    }
}

describe('native fence adapter ownership and uncertainty', function () {
    // Filesystem fault injection lives with the native owner in
    // core/src/storage/fence/tests.rs; these tests exercise the RPC boundary.
    it('uses exactly one native command per admission, verified reuse, drain and release', async function () {
        const commands = vi.spyOn(core, 'runCoreCommandService')
        const shared = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        expect(commands.mock.calls.map((call) => call[1].operation)).toEqual([
            'fenceAdmitShared',
        ])
        const reused = await admitShared({
            rootDirectory: fixture.rootDirectory,
            currentLease: shared,
        })
        expect(reused).toBe(shared)
        expect(commands.mock.calls.map((call) => call[1].operation)).toEqual([
            'fenceAdmitShared',
            'fenceAdmitShared',
        ])
        await release(shared)
        const exclusive = await acquireExclusive({
            rootDirectory: fixture.rootDirectory,
            tryOnly: false,
        })
        if (!exclusive) throw new Error('Missing native exclusive lease.')
        await drain(exclusive)
        await release(exclusive)
        expect(commands.mock.calls.map((call) => call[1].operation)).toEqual([
            'fenceAdmitShared',
            'fenceAdmitShared',
            'fenceRelease',
            'fenceAcquireExclusive',
            'fenceDrain',
            'fenceRelease',
        ])
    })

    it.each([
        [
            'STORAGE_MUTATION_ADMISSION_BUSY',
            false,
            StorageMutationAdmissionBusyError,
        ],
        [
            'STORAGE_MUTATION_ADMISSION_BUSY',
            true,
            StorageMutationFenceUnavailableError,
        ],
        [
            'STORAGE_MUTATION_FENCE_UNAVAILABLE',
            false,
            StorageMutationFenceUnavailableError,
        ],
        ['CORE_CANCELLED', false, StorageMutationFenceUnavailableError],
        ['CORE_TIMEOUT', true, StorageMutationFenceUnavailableError],
    ] as const)(
        'maps native errors without treating uncertain mutations as busy: %s / %s',
        async function (code, uncertain, expected) {
            vi.spyOn(core, 'runCoreCommandService').mockRejectedValue(
                new CoreCommandError(code, 'Synthetic failure.', { uncertain }),
            )
            await expect(
                admitShared({ rootDirectory: fixture.rootDirectory }),
            ).rejects.toBeInstanceOf(expected)
            await expect(
                acquireExclusive({
                    rootDirectory: fixture.rootDirectory,
                    tryOnly: false,
                }),
            ).rejects.toBeInstanceOf(expected)
        },
    )

    it.each([
        'context',
        'identity',
        'owner',
        'kind',
        'filePath',
        'sharedPath',
        'directories',
        'version',
        'extra',
    ] as const)(
        'rejects malformed native leases: %s',
        async function (mutation) {
            const original = await admitShared({
                rootDirectory: fixture.rootDirectory,
            })
            const native = JSON.parse(JSON.stringify(wire(original)))
            if (mutation === 'context')
                native.context.rootDirectory = fixture.temporaryDirectory
            if (mutation === 'identity') native.file.identity.ino = '0'
            if (mutation === 'owner') native.file.metadata.owner = 'invalid'
            if (mutation === 'kind') native.file.metadata.kind = 'admission'
            if (mutation === 'filePath')
                native.file.path = path.join(
                    fixture.temporaryDirectory,
                    'foreign',
                )
            if (mutation === 'sharedPath')
                native.context.sharedDirectory = fixture.temporaryDirectory
            if (mutation === 'directories') native.context.directories.reverse()
            if (mutation === 'version') native.file.metadata.version = 2
            if (mutation === 'extra') native.extra = true
            const command = mockResult(native)
            await expect(
                admitShared({ rootDirectory: fixture.rootDirectory }),
            ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
            expect(command).toHaveBeenCalledTimes(1)
            command.mockRestore()
            await release(original)
        },
    )

    it('rejects a substituted but structurally valid reused lease', async function () {
        const original = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const replacement = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const command = mockResult(wire(replacement))
        await expect(
            admitShared({
                rootDirectory: fixture.rootDirectory,
                currentLease: original,
            }),
        ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
        command.mockRestore()
        await release(original)
        await release(replacement)
    })

    it('rejects malformed acknowledgements and busy errors during release and drain', async function () {
        const lease = await acquireExclusive({
            rootDirectory: fixture.rootDirectory,
            tryOnly: false,
        })
        if (!lease) throw new Error('Missing test lease.')
        /* eslint-disable no-await-in-loop -- Each malformed reply has a separate command spy restored before the next reply. */
        for (const value of [
            null,
            {},
            { ok: false },
            { ok: true, extra: true },
        ]) {
            const command = mockResult(value)
            await expect(release(lease)).rejects.toBeInstanceOf(
                StorageMutationFenceUnavailableError,
            )
            await expect(drain(lease)).rejects.toBeInstanceOf(
                StorageMutationFenceUnavailableError,
            )
            command.mockRestore()
        }
        /* eslint-enable no-await-in-loop */
        const command = vi
            .spyOn(core, 'runCoreCommandService')
            .mockRejectedValue(
                new CoreCommandError(
                    'STORAGE_MUTATION_ADMISSION_BUSY',
                    'Synthetic failure.',
                ),
            )
        await expect(release(lease)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        await expect(drain(lease)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        command.mockRestore()
        await release(lease)
    })

    it('accepts null only for an explicit exclusive try and rejects shared drain before RPC', async function () {
        const shared = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const command = mockResult(null)
        expect(
            await acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: true,
            }),
        ).toBeNull()
        await expect(
            acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: false,
            }),
        ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
        await expect(drain(shared)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        expect(command).toHaveBeenCalledTimes(2)
        command.mockRestore()
        await release(shared)
    })

    it('rejects unexpected control-root entries without removing them', async function () {
        const shared = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        await release(shared)
        const foreign = path.join(fixture.rootDirectory, 'unexpected-state')
        await filesystem.writeFile(foreign, 'preserve', { mode: 0o600 })
        await expect(
            acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: true,
            }),
        ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
        expect(await filesystem.readFile(foreign, 'utf8')).toBe('preserve')
    })
    it.each(['shared', 'exclusive', 'admission'])(
        'preserves crash ownership across fresh processes',
        async function (kind) {
            const source = pathToFileURL(
                path.resolve(
                    'web/src/server/Storage/storage-mutation-fence.service.ts',
                ),
            ).href
            const root = JSON.stringify(fixture.rootDirectory)
            const script =
                kind === 'admission'
                    ? `import {mkdir} from 'node:fs/promises'; await mkdir(${root},{recursive:true,mode:0o700}); await mkdir(${JSON.stringify(gatePath())},{mode:0o700}); process.exit(0)`
                    : `import {admitSharedStorageMutationFenceService,acquireExclusiveStorageMutationFenceService} from ${JSON.stringify(source)}; await ${kind === 'shared' ? 'admitSharedStorageMutationFenceService' : 'acquireExclusiveStorageMutationFenceService'}({rootDirectory:${root},tryOnly:false}); process.exit(0)`
            expect(await runIsolatedControlProcess(script)).toBe('')
            const second = `import {acquireExclusiveStorageMutationFenceService} from ${JSON.stringify(source)}; const acquired=await acquireExclusiveStorageMutationFenceService({rootDirectory:${root},tryOnly:true}); process.stdout.write(String(acquired===null));`
            expect(await runIsolatedControlProcess(second)).toBe('true')
            if (kind === 'shared')
                expect(
                    await filesystem.readdir(
                        path.join(fixture.rootDirectory, 'shared'),
                    ),
                ).toHaveLength(1)
            if (kind === 'exclusive')
                expect(
                    await Bun.file(
                        path.join(
                            fixture.rootDirectory,
                            config.exclusiveFileName,
                        ),
                    ).exists(),
                ).toBe(true)
            if (kind === 'admission')
                expect((await filesystem.lstat(gatePath())).isDirectory()).toBe(
                    true,
                )
        },
    )
})
