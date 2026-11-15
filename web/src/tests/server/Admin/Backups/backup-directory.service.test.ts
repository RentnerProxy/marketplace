import { beforeEach, describe, expect, it, vi } from 'bun:test'
import path from 'node:path'

const roots = {
    backupDirectory: path.resolve('synthetic-fixture', 'backups'),
    storageDirectory: path.resolve('synthetic-fixture', 'storage'),
}
const core = vi.fn(
    async (
        _binary: string,
        request: Record<string, unknown>,
        options: { validateResult: (value: unknown) => unknown },
    ) => {
        const names = request.fileNames as string[]
        return options.validateResult({
            paths: names.map((name) => path.join(roots.backupDirectory, name)),
        })
    },
)
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: (key: string) =>
        key === 'BACKUP_DIR' ? roots.backupDirectory : roots.storageDirectory,
}))
const { getBackupFilePath, getBackupFilePaths, getBackupStoragePaths } =
    await import('@/server/Admin/Backups/backup-directory.service.ts')
beforeEach(() => core.mockClear())

describe('backup directory native boundary', () => {
    it('reads configured roots without issuing a filesystem command', () => {
        expect(getBackupStoragePaths()).toEqual(roots)
        expect(core).not.toHaveBeenCalled()
    })
    it('prepares every requested path in one validated command', async () => {
        expect(await getBackupFilePaths(['a.tar', 'b.tar'])).toEqual(
            ['a.tar', 'b.tar'].map((name) =>
                path.join(roots.backupDirectory, name),
            ),
        )
        expect(core).toHaveBeenCalledTimes(1)
        expect(core.mock.calls[0]?.slice(0, 2)).toEqual([
            'storage',
            {
                operation: 'backupPreparePaths',
                ...roots,
                fileNames: ['a.tar', 'b.tar'],
            },
        ])
    })
    it('retains the single-path API with exactly one command', async () => {
        expect(await getBackupFilePath('backup.tar')).toBe(
            path.join(roots.backupDirectory, 'backup.tar'),
        )
        expect(core).toHaveBeenCalledTimes(1)
    })
    it.each([
        '.',
        '..',
        '../backup.tar',
        'nested/backup.tar',
        'backup name.tar',
        '',
        'x'.repeat(256),
    ])('rejects invalid basename %s before calling Rust', async (name) => {
        await expect(getBackupFilePath(name)).rejects.toThrow(
            'Ungültiger Backup-Dateiname',
        )
        expect(core).not.toHaveBeenCalled()
    })
    it.each([
        { paths: [] },
        { paths: [path.join(roots.storageDirectory, 'backup.tar')] },
        {
            paths: [path.join(roots.backupDirectory, 'backup.tar')],
            extra: true,
        },
        { paths: [null] },
    ])(
        'rejects a missing, redirected or malformed native result',
        async (result) => {
            core.mockImplementationOnce(async (_binary, _request, options) =>
                options.validateResult(result),
            )
            await expect(getBackupFilePath('backup.tar')).rejects.toThrow()
        },
    )
    it('does not accept the right paths in the wrong order', async () => {
        core.mockImplementationOnce(async (_binary, _request, options) =>
            options.validateResult({
                paths: ['b.tar', 'a.tar'].map((name) =>
                    path.join(roots.backupDirectory, name),
                ),
            }),
        )
        await expect(getBackupFilePaths(['a.tar', 'b.tar'])).rejects.toThrow(
            'Ungültige Backup-Pfade',
        )
    })
    it('propagates an unconfirmed preparation failure', async () => {
        const error = new Error('synthetic filesystem failure')
        core.mockRejectedValueOnce(error)
        await expect(getBackupFilePath('backup.tar')).rejects.toBe(error)
    })
})
