import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupErrorHandler } from './backup-client.types.ts'
import type { BackupRun, BackupStats } from './backup-domain.types.ts'

export type BackupLogicState = {
    settings: BackupSettings
    runs: Array<BackupRun>
    stats: BackupStats
    nextBackupAt: string | null
    restoreBackupId: string | null
    deleteBackupId: string | null
    deleteBackup: BackupRun | undefined
    restoreConfirmation: string
    isLoading: boolean
    isSaving: boolean
    isCreating: boolean
    isImporting: boolean
    activeActionId: string | null
}

export type BackupLogicHandler = {
    handleSettingsChange: <TKey extends keyof BackupSettings>(
        key: TKey,
        value: BackupSettings[TKey],
    ) => void
    handleSaveSettings: () => void
    handleCreateBackup: () => void
    handleImportBackup: (file: File | null) => void
    handleDeleteBackup: (backupId: string) => void
    handleCancelDeleteBackup: () => void
    handleConfirmDeleteBackup: () => void
    handleOpenRestore: (backupId: string) => void
    handleCancelRestore: () => void
    handleRestoreConfirmationChange: (value: string) => void
    handleRestoreBackup: () => void
}

export type BackupLogicReturn = {
    state: BackupLogicState
    handler: BackupLogicHandler
}

export type UseBackupSettingsFormParams = {
    storedSettings: BackupSettings | undefined
    onError: BackupErrorHandler
}

export type UseBackupScheduleSettingsParams = {
    settings: Pick<
        BackupSettings,
        'scheduleType' | 'scheduleHour' | 'scheduleMinute' | 'scheduleWeekdays'
    >
    onSettingsChange: BackupLogicHandler['handleSettingsChange']
}

export type BackupScheduleSettingsLogicReturn = {
    state: {
        weekdays: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6>
        selectedWeekdays: Array<number>
        timeValue: string
        intervalWeekday: string
        showsTime: boolean
        showsWeekdays: boolean
        showsInterval: boolean
    }
    handler: {
        handleToggleWeekday: (day: number) => void
        handleTimeChange: (value: string) => void
    }
}

export type UseBackupRunActionsParams = {
    onError: BackupErrorHandler
}

export type UseBackupImportParams = {
    onError: BackupErrorHandler
}

export type UseManualBackupCreationParams = {
    onError: BackupErrorHandler
}

export type PendingManualBackupIntentLogicReturn = {
    state: {
        pendingManualBackupId: string | null
    }
    handler: {
        handleSetPendingManualBackup: (runId: string) => boolean
    }
}
