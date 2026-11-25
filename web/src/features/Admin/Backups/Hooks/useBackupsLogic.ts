import { useQuery } from '@tanstack/react-query'
import { translateCurrentLanguage } from '@/language/languageStore.ts'
import { backupOverviewQueryOptions } from '@/lib/Backups/backupCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import type { BackupLogicReturn } from '../Types/backup-logic.types.ts'
import type { BackupRun, BackupStats } from '../Types/backup-domain.types.ts'
import useBackupImport from './useBackupImport.ts'
import useBackupRunActions from './useBackupRunActions.ts'
import useBackupSettingsForm from './useBackupSettingsForm.ts'
import useManualBackupCreation from './useManualBackupCreation.ts'

const EMPTY_BACKUP_RUNS: Array<BackupRun> = []
const EMPTY_BACKUP_STATS: BackupStats = {
    total: 0,
    successful: 0,
    failed: 0,
    imported: 0,
    restored: 0,
}

function showError(error: unknown) {
    toastAppError(error, translateCurrentLanguage('common.error'))
}

export default function useBackupsLogic(): BackupLogicReturn {
    const overviewQuery = useQuery(backupOverviewQueryOptions())
    const runs = overviewQuery.data?.runs ?? EMPTY_BACKUP_RUNS
    const settingsLogic = useBackupSettingsForm({
        storedSettings: overviewQuery.data?.settings,
        onError: showError,
    })
    const manualBackupCreationLogic = useManualBackupCreation({
        onError: showError,
    })
    const backupImportLogic = useBackupImport({ onError: showError })
    const backupRunActionsLogic = useBackupRunActions({
        onError: showError,
    })

    return {
        state: {
            settings: settingsLogic.state.settings,
            isSaving: settingsLogic.state.isSaving,
            runs,
            stats: overviewQuery.data?.stats ?? EMPTY_BACKUP_STATS,
            nextBackupAt: overviewQuery.data?.nextBackupAt ?? null,
            restoreBackupId: backupRunActionsLogic.state.restoreBackupId,
            deleteBackupId: backupRunActionsLogic.state.deleteBackupId,
            deleteBackup: runs.find(
                (run) => run.id === backupRunActionsLogic.state.deleteBackupId,
            ),
            restoreConfirmation:
                backupRunActionsLogic.state.restoreConfirmation,
            activeActionId: backupRunActionsLogic.state.activeActionId,
            isLoading: overviewQuery.isLoading,
            isCreating: manualBackupCreationLogic.state.isCreating,
            isImporting: backupImportLogic.state.isImporting,
        },
        handler: {
            handleSettingsChange: settingsLogic.handler.handleSettingsChange,
            handleSaveSettings: settingsLogic.handler.handleSaveSettings,
            handleCreateBackup:
                manualBackupCreationLogic.handler.handleCreateBackup,
            handleImportBackup: backupImportLogic.handler.handleImportBackup,
            handleDeleteBackup:
                backupRunActionsLogic.handler.handleDeleteBackup,
            handleCancelDeleteBackup:
                backupRunActionsLogic.handler.handleCancelDeleteBackup,
            handleConfirmDeleteBackup:
                backupRunActionsLogic.handler.handleConfirmDeleteBackup,
            handleOpenRestore: backupRunActionsLogic.handler.handleOpenRestore,
            handleCancelRestore:
                backupRunActionsLogic.handler.handleCancelRestore,
            handleRestoreConfirmationChange:
                backupRunActionsLogic.handler.handleRestoreConfirmationChange,
            handleRestoreBackup:
                backupRunActionsLogic.handler.handleRestoreBackup,
        },
    }
}
