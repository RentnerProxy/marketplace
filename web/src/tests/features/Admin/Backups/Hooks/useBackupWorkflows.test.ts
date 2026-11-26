import * as Query from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Promise<unknown>[] = []
let overview: unknown
let loading = false
let mutationPending = false
const mocks = {
    save: vi.fn(async (_input: unknown) => undefined),
    remove: vi.fn(async (_input: unknown) => undefined),
    restore: vi.fn(async (_input: unknown) => undefined),
    fetch: vi.fn<typeof fetch>(),
    error: vi.fn(),
    toastError: vi.fn(),
    success: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
}
const transfer = vi.fn(() => ({ complete: mocks.complete, fail: mocks.fail }))
vi.mock('react', () => ({
    ...hookReact,
    useCallback: <T>(callback: T) => callback,
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => client,
    useQuery: () => ({ data: overview, isLoading: loading }),
    useMutation<TData, TError, TVariables, TContext>(
        options: UseMutationOptions<TData, TError, TVariables, TContext>,
    ) {
        const observer = new queryExports.MutationObserver(client, options)
        return {
            isPending: mutationPending,
            mutate: (variables: TVariables) => {
                pending.push(observer.mutate(variables).catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/features/Admin/Backups/middleware.ts', () => ({
    updateBackupSettingsHandler: mocks.save,
    deleteBackupHandler: mocks.remove,
    restoreBackupHandler: mocks.restore,
}))
vi.mock('@/lib/Backups/backupCache.ts', () => ({
    ADMIN_BACKUPS_QUERY_KEY: ['admin-backups'],
    backupOverviewQueryOptions: () => ({ queryKey: ['admin-backups'] }),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/language/languageStore.ts', () => ({
    translateCurrentLanguage: () => 'Error',
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { success: mocks.success, error: mocks.toastError },
}))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: transfer,
}))
vi.mock('@/lib/Backups/backupTransfer.ts', () => ({
    failBackupTransfer: (_task: unknown, error: unknown) => {
        mocks.fail(error)
        return error
    },
}))
vi.mock('@/features/Admin/Backups/Hooks/useManualBackupCreation.ts', () => ({
    default: () => ({
        state: { isCreating: false },
        handler: { handleCreateBackup: vi.fn() },
    }),
}))
const { default: useSettings } =
    await import('@/features/Admin/Backups/Hooks/useBackupSettingsForm.ts')
const { default: useActions } =
    await import('@/features/Admin/Backups/Hooks/useBackupRunActions.ts')
const { default: useImport } =
    await import('@/features/Admin/Backups/Hooks/useBackupImport.ts')
const { default: useBackups } =
    await import('@/features/Admin/Backups/Hooks/useBackupsLogic.ts')
async function flushImports() {
    let task = Promise.resolve()
    for (let turn = 0; turn < 16; turn++) task = task.then(() => undefined)
    await task
}
const renderBackups = () => renderHook(useBackups)
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    pending.length = 0
    overview = undefined
    loading = false
    mutationPending = false
    client.clear()
    mocks.save.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
    mocks.restore.mockResolvedValue(undefined)
    stubTestGlobal('fetch', mocks.fetch)
})
afterEach(() => {
    client.clear()
    restoreTestGlobals()
})

it('edits default settings and saves only the supported editable fields', async () => {
    const render = () =>
        renderHook(() =>
            useSettings({ storedSettings: undefined, onError: mocks.error }),
        )
    expect(render().state.settings.targetKey).toBeDefined()
    render().handler.handleSettingsChange('retentionCount', 12)
    render().handler.handleSettingsChange('includeStorage', false)
    const settings = render().state.settings
    render().handler.handleSaveSettings()
    await Promise.all(pending)
    expect(mocks.save).toHaveBeenCalledWith({
        data: {
            isEnabled: settings.isEnabled,
            scheduleType: settings.scheduleType,
            scheduleInterval: settings.scheduleInterval,
            scheduleWeekdays: settings.scheduleWeekdays,
            scheduleHour: settings.scheduleHour,
            scheduleMinute: settings.scheduleMinute,
            retentionMode: settings.retentionMode,
            retentionDays: settings.retentionDays,
            retentionCount: 12,
            includeStorage: false,
        },
    })
    expect(mocks.success).toHaveBeenCalledTimes(1)
    expect(mocks.error).not.toHaveBeenCalled()
})

it('refreshes settings when the stored object changes and reports save failure', async () => {
    let storedSettings: BackupSettings | undefined
    const render = () =>
        renderHook(() => useSettings({ storedSettings, onError: mocks.error }))
    const initial = render().state.settings
    storedSettings = { ...initial, retentionDays: 40 }
    render()
    expect(render().state.settings.retentionDays).toBe(40)
    storedSettings = undefined
    render()
    expect(render().state.settings.retentionDays).toBe(40)
    const failure = new Error('Synthetic save rejection')
    mocks.save.mockRejectedValueOnce(failure)
    render().handler.handleSaveSettings()
    await Promise.all(pending)
    expect(mocks.error.mock.calls[0]?.[0]).toBe(failure)
})

it('selects, cancels and confirms deletion and resets its active action after success', async () => {
    const render = () => renderHook(() => useActions({ onError: mocks.error }))
    render().handler.handleConfirmDeleteBackup()
    expect(mocks.remove).not.toHaveBeenCalled()
    render().handler.handleDeleteBackup('backup-1')
    mutationPending = true
    render().handler.handleCancelDeleteBackup()
    expect(render().state.deleteBackupId).toBe('backup-1')
    mutationPending = false
    render().handler.handleCancelDeleteBackup()
    expect(render().state.deleteBackupId).toBeNull()
    render().handler.handleDeleteBackup('backup-2')
    render().handler.handleConfirmDeleteBackup()
    await Promise.all(pending)
    expect(mocks.remove).toHaveBeenCalledWith({
        data: { backupId: 'backup-2' },
    })
    expect(render().state.deleteBackupId).toBeNull()
    expect(render().state.activeActionId).toBeNull()
})

it('requires a selected run and exact restore phrase before sending a mocked restore request', async () => {
    const render = () => renderHook(() => useActions({ onError: mocks.error }))
    render().handler.handleRestoreBackup()
    await Promise.all(pending)
    expect(mocks.restore).not.toHaveBeenCalled()
    render().handler.handleOpenRestore('backup-1')
    render().handler.handleRestoreConfirmationChange('wrong')
    render().handler.handleRestoreBackup()
    await Promise.all(pending)
    expect(mocks.restore).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledTimes(2)
    render().handler.handleCancelRestore()
    expect(render().state.restoreBackupId).toBeNull()
    expect(render().state.restoreConfirmation).toBe('')
    render().handler.handleOpenRestore('backup-2')
    render().handler.handleRestoreConfirmationChange('WIEDERHERSTELLEN')
    render().handler.handleRestoreBackup()
    await Promise.all(pending)
    expect(mocks.restore).toHaveBeenCalledWith({
        data: { backupId: 'backup-2', confirmation: 'WIEDERHERSTELLEN' },
    })
    expect(render().state.restoreBackupId).toBeNull()
    expect(render().state.activeActionId).toBeNull()
    expect(mocks.success).toHaveBeenCalledTimes(1)
})

it.each(['success', 'rejected', 'malformed', 'network'] as const)(
    'handles a synthetic file import result: %s',
    async (mode) => {
        const file = new File(['synthetic archive marker'], 'fixture.backup')
        const render = () =>
            renderHook(() => useImport({ onError: mocks.error }))
        render().handler.handleImportBackup(null)
        expect(mocks.fetch).not.toHaveBeenCalled()
        if (mode === 'network')
            mocks.fetch.mockRejectedValueOnce(new Error('offline'))
        else
            mocks.fetch.mockResolvedValueOnce(
                Response.json(
                    mode === 'malformed'
                        ? {}
                        : {
                              success: mode === 'success',
                              error: 'Synthetic import rejection',
                          },
                    { status: mode === 'rejected' ? 400 : 200 },
                ),
            )
        render().handler.handleImportBackup(file)
        expect(render().state.isImporting).toBe(true)
        await flushImports()
        expect(mocks.fetch).toHaveBeenCalledWith(
            '/api/admin/backups/import',
            expect.objectContaining({ method: 'POST', body: file }),
        )
        expect(transfer).toHaveBeenCalledWith(
            expect.objectContaining({
                direction: 'upload',
                totalBytes: file.size,
            }),
        )
        expect(render().state.isImporting).toBe(false)
        expect(mocks.complete).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0)
        expect(mocks.error).toHaveBeenCalledTimes(mode === 'success' ? 0 : 1)
    },
)

it('composes empty and populated overview state and routes child errors to a toast', async () => {
    loading = true
    expect(renderBackups().state.runs).toEqual([])
    expect(renderBackups().state.stats.total).toBe(0)
    expect(renderBackups().state.nextBackupAt).toBeNull()
    expect(renderBackups().state.isLoading).toBe(true)
    overview = {
        runs: [{ id: 'run-1' }, { id: 'run-2' }],
        stats: { total: 2, successful: 1, failed: 1, imported: 0, restored: 0 },
        nextBackupAt: '2027-01-01T00:00:00Z',
    }
    renderBackups().handler.handleDeleteBackup('run-2')
    expect(renderBackups().state.deleteBackup).toMatchObject({ id: 'run-2' })
    expect(renderBackups().state.stats.total).toBe(2)
    mocks.remove.mockRejectedValueOnce(
        new Error('Synthetic deletion rejection'),
    )
    renderBackups().handler.handleConfirmDeleteBackup()
    await Promise.all(pending)
    expect(mocks.toastError).toHaveBeenCalledWith(
        'Synthetic deletion rejection',
        expect.objectContaining({ title: 'Error', dedupeWindow: 2_000 }),
    )
})
