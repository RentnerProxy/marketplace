import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { UseClientTableOptions } from '@/shared/Table/Types/client-table.types.ts'
import type { BackupRun } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import type { UseBackupRunsCardLogicParams } from '@/features/Admin/Backups/Components/BackupRunsCard/Types/backup-table.types.ts'
import { completedRun } from '../../backupFixtures.ts'

const tableMarker = { id: 'synthetic-table' }
const search = mock()
let tableOptions: UseClientTableOptions<BackupRun> | undefined
let tick: (() => void) | undefined
const clearInterval = mock()
const setInterval = mock((callback: () => void, milliseconds: number) => {
    tick = callback
    expect(milliseconds).toBe(1000)
    return 123
})
mock.module('react', () => hookReact)
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module('@/shared/Table/Hooks/useClientTable.ts', () => ({
    default: (options: UseClientTableOptions<BackupRun>) => {
        tableOptions = options
        return {
            table: tableMarker,
            state: { searchInput: 'archive' },
            handler: { handleSearchInputChange: search },
        }
    },
}))
const { default: useBackupRunsCardLogic } =
    await import('@/features/Admin/Backups/Components/BackupRunsCard/Hooks/useBackupRunsCardLogic.ts')
const params: UseBackupRunsCardLogicParams = {
    runs: [completedRun],
    nextBackupAt: null,
    activeActionId: null,
    onOpenRestore: mock(),
    onDeleteBackup: mock(),
}

beforeEach(() => {
    resetHooks()
    tick = undefined
    tableOptions = undefined
    search.mockClear()
    setInterval.mockClear()
    clearInterval.mockClear()
    stubTestGlobal('window', { setInterval, clearInterval })
})
afterEach(restoreTestGlobals)

describe('Backup runs table logic', () => {
    it('preserves table identity, initial sorting and the search handler, and toggles filters across renders', () => {
        let logic = renderHook(() => useBackupRunsCardLogic(params))
        expect(Object.is(logic.table, tableMarker)).toBe(true)
        expect(logic.state.searchInput).toBe('archive')
        expect(logic.state.nextBackupIn).toBeNull()
        expect(logic.state.columnCount).toBe(7)
        expect(tableOptions?.data).toBe(params.runs)
        expect(tableOptions?.initialSorting).toEqual([
            { id: 'startedAt', desc: true },
        ])
        expect(tableOptions?.getRowId(completedRun)).toBe(completedRun.id)
        logic.handler.handleSearchInputChange('manual')
        expect(search).toHaveBeenCalledWith('manual')
        expect(logic.state.showColumnFilters).toBe(false)
        logic.handler.handleToggleColumnFilters()
        logic = renderHook(() => useBackupRunsCardLogic(params))
        expect(logic.state.showColumnFilters).toBe(true)
        logic.handler.handleToggleColumnFilters()
        expect(
            renderHook(() => useBackupRunsCardLogic(params)).state
                .showColumnFilters,
        ).toBe(false)
        const cleanup = runEffects()
        cleanup()
        expect(setInterval).not.toHaveBeenCalled()
    })

    it('ticks a scheduled countdown and cleans up its timer on unmount', () => {
        const nextBackupAt = new Date(Date.now() + 120000).toISOString()
        const logic = renderHook(() =>
            useBackupRunsCardLogic({ ...params, nextBackupAt }),
        )
        expect(logic.state.nextBackupIn).not.toBeNull()
        const cleanup = runEffects()
        expect(setInterval).toHaveBeenCalledTimes(1)
        expect(tick).toBeDefined()
        tick?.()
        expect(
            renderHook(() =>
                useBackupRunsCardLogic({ ...params, nextBackupAt }),
            ).state.nextBackupIn,
        ).not.toBeNull()
        cleanup()
        expect(clearInterval).toHaveBeenCalledWith(123)
    })
})
