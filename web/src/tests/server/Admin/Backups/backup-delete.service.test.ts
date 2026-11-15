import { beforeEach, expect, it, vi } from 'bun:test'

const state = { response: { ok: true } as unknown, error: null as Error | null }
const runCore = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    options: { validateResult: (value: unknown) => unknown },
) {
    if (state.error) throw state.error
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
const { deleteBackupFilesService } =
    await import('@/server/Admin/Backups/backup-delete.service.ts')

beforeEach(() => {
    runCore.mockClear()
    state.response = { ok: true }
    state.error = null
})

it('delegiert Backup-Löschung als einen begrenzten Core-Auftrag', async () => {
    await deleteBackupFilesService(['a.tar', 'b.tar'])
    expect(runCore).toHaveBeenCalledTimes(1)
    expect(runCore.mock.calls[0]?.slice(0, 2)).toEqual([
        'storage',
        {
            operation: 'backupDeleteFiles',
            backupDirectory: '/configured/backups',
            storageDirectory: '/configured/storage',
            fileNames: ['a.tar', 'b.tar'],
        },
    ])
})

it.each([{ ok: false }, { ok: true, deleted: 1 }, null])(
    'verwirft eine unbestätigte oder unerwartete Löschantwort: %s',
    async (response) => {
        state.response = response
        await expect(deleteBackupFilesService(['a.tar'])).rejects.toThrow()
        expect(runCore).toHaveBeenCalledTimes(1)
    },
)

it('wiederholt eine teilweise unbestätigte Löschung nicht', async () => {
    state.error = Object.assign(new Error('Unbestätigte Löschung'), {
        code: 'CORE_OPERATION_UNCERTAIN',
    })
    await expect(deleteBackupFilesService(['a.tar'])).rejects.toBe(state.error)
    expect(runCore).toHaveBeenCalledTimes(1)
})
