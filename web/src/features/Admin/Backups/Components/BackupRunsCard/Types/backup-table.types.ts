import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { ColumnDef } from '@tanstack/react-table'

import type { BackupRun } from '../../../Types/backup-domain.types.ts'

export type UseBackupTableColumnsParams = {
    activeActionId: string | null
    onOpenRestore: (backupId: string) => void
    onDeleteBackup: (backupId: string) => void
}

export type BackupTableColumns = Array<
    ColumnDef<ClientTableFeatures, BackupRun>
>

import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type {
    TableColumnFilterConfigs,
    TableFilterOption,
} from '@/shared/Table/Types/table.types.ts'
import type {
    BackupLogicState,
    BackupLogicHandler,
} from '../../../Types/backup-logic.types.ts'

export type BackupRunsCardProps = {
    state: Pick<
        BackupLogicState,
        | 'runs'
        | 'stats'
        | 'nextBackupAt'
        | 'restoreBackupId'
        | 'restoreConfirmation'
        | 'isLoading'
        | 'activeActionId'
    > & { isAutomaticBackupEnabled: boolean }
    handler: Pick<
        BackupLogicHandler,
        | 'handleDeleteBackup'
        | 'handleOpenRestore'
        | 'handleCancelRestore'
        | 'handleRestoreConfirmationChange'
        | 'handleRestoreBackup'
    >
}

export type BackupRunsCardLogicReturn = {
    table: ClientTable<BackupRun>
    state: {
        searchInput: string
        showColumnFilters: boolean
        nextBackupIn: string | null
        pageSizeOptions: Array<TableFilterOption<number>>
        columnFilterConfigs: TableColumnFilterConfigs
        columnCount: number
    }
    handler: {
        handleSearchInputChange: (filter: string) => void
        handleToggleColumnFilters: () => void
    }
}

export type UseBackupRunsCardLogicParams = {
    runs: Array<BackupRun>
    nextBackupAt: string | null
    activeActionId: string | null
    onOpenRestore: BackupLogicHandler['handleOpenRestore']
    onDeleteBackup: BackupLogicHandler['handleDeleteBackup']
}
