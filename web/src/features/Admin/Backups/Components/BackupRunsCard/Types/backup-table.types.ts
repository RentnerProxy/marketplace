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

export type UseBackupTableColumnsParams = {
    activeActionId: string | null
    onOpenRestore: BackupLogicHandler['handleOpenRestore']
    onDeleteBackup: BackupLogicHandler['handleDeleteBackup']
}
