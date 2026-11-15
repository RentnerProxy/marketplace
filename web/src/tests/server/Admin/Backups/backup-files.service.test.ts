import { beforeEach, expect, it, vi } from 'bun:test'

const state = { response: { ok: true } as unknown }
const runCore = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    options: { validateResult: (value: unknown) => unknown },
) {
    return options.validateResult(state.response)
})
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: runCore,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths: () => ({
        backupDirectory: '/configured/backups',
        storageDirectory: '/configured/storage',
    }),
}))
const { publishBackupFileService } =
    await import('@/server/Admin/Backups/backup-files.service.ts')

beforeEach(() => {
    runCore.mockClear()
    state.response = { ok: true }
})

it('veröffentlicht eine Backup-Datei in einem einzigen bestätigten Core-Auftrag', async () => {
    const signal = new AbortController().signal
    await publishBackupFileService(
        '/configured/backups/stage/archive.partial',
        '/configured/backups/archive.tar',
        { signal },
    )
    expect(runCore).toHaveBeenCalledTimes(1)
    expect(runCore.mock.calls[0]?.slice(0, 2)).toEqual([
        'storage',
        {
            operation: 'backupPublishFile',
            backupDirectory: '/configured/backups',
            storageDirectory: '/configured/storage',
            sourcePath: '/configured/backups/stage/archive.partial',
            destinationPath: '/configured/backups/archive.tar',
        },
    ])
    expect(runCore.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ signal }),
    )
})

it('verwirft eine unbestätigte Veröffentlichung', async () => {
    state.response = { ok: false }
    await expect(
        publishBackupFileService(
            '/configured/backups/a',
            '/configured/backups/b',
        ),
    ).rejects.toThrow()
})
