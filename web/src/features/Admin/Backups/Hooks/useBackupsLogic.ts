import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'
import { backupOverviewQueryOptions } from '@/lib/Backups/backupCache.ts'
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

export default function useBackupsLogic(): BackupLogicReturn {
    const { t } = useTranslationStore()
    const overviewQuery = useQuery(backupOverviewQueryOptions())
    const runs = overviewQuery.data?.runs ?? EMPTY_BACKUP_RUNS
    const showError = useCallback(
        function (error: unknown) {
            toast.error(getErrorMessage(error, t('common.error')), {
                title: t('common.error'),
            })
        },
        [t],
    )
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
