import { beforeEach, describe, expect, test, vi } from 'bun:test'

const mocks = {
    result: null as unknown,
    run: vi.fn(
        async (
            _binary: string,
            _request: Record<string, unknown>,
            options: { validateResult: (value: unknown) => unknown },
        ) => options.validateResult(mocks.result),
    ),
}
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: mocks.run,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths: () => ({
        backupDirectory: 'synthetic-backup',
        storageDirectory: 'synthetic-storage',
    }),
}))
const {
    getRestoreStateService,
    getPublicRestoreStateService,
    isRestoreStateActiveService,
    writeRestoreStateService,
    getRestoreStateFromProgress,
} = await import('@/server/Admin/Backups/restore-state.service.ts')
const state = {
    version: 1 as const,
    status: 'running' as const,
    phase: 'validating' as const,
    percent: 25,
    processedBytes: 25,
    totalBytes: 100,
    startedAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:01.000Z',
}
beforeEach(() => {
    mocks.result = null
    mocks.run.mockClear()
})

describe('restore state coarse core boundary', () => {
    test('reads and validates the state through one coarse operation', async () => {
        await expect(getRestoreStateService()).resolves.toBeNull()
        mocks.result = state
        await expect(getRestoreStateService()).resolves.toEqual(state)
        expect(mocks.run.mock.calls[1]?.slice(0, 2)).toEqual([
            'storage',
            {
                operation: 'restoreStateGet',
                backupDirectory: 'synthetic-backup',
                storageDirectory: 'synthetic-storage',
            },
        ])
    })
    test('malformed responses remain locked and produce a public running fallback', async () => {
        mocks.result = { version: 99 }
        await expect(getRestoreStateService()).rejects.toThrow()
        await expect(isRestoreStateActiveService()).resolves.toBe(true)
        await expect(getPublicRestoreStateService()).resolves.toMatchObject({
            status: 'running',
            phase: 'preparing',
            percent: null,
        })
    })
    test('confirms the exact published state and rejects a mismatched valid response', async () => {
        mocks.result = state
        await expect(writeRestoreStateService(state)).resolves.toEqual(state)
        expect(mocks.run.mock.calls[0]?.[1]).toMatchObject({
            operation: 'restoreStateWrite',
            state,
        })
        mocks.result = { ...state, percent: 50 }
        await expect(writeRestoreStateService(state)).rejects.toThrow(
            'nicht bestätigt',
        )
    })
    test('rejects inconsistent progress before invoking persistence', async () => {
        await expect(
            writeRestoreStateService({ ...state, totalBytes: 0 }),
        ).rejects.toThrow()
        expect(mocks.run).not.toHaveBeenCalled()
    })
    test('maps progress to the unchanged public running shape', () => {
        expect(
            getRestoreStateFromProgress(
                {
                    version: 1,
                    phase: 'validating',
                    percent: 25,
                    processedBytes: 25,
                    totalBytes: 100,
                    updatedAt: state.updatedAt,
                },
                state.startedAt,
            ),
        ).toEqual({
            status: 'running',
            phase: 'validating',
            percent: 25,
            processedBytes: 25,
            totalBytes: 100,
            startedAt: state.startedAt,
            updatedAt: state.updatedAt,
        })
    })
})
