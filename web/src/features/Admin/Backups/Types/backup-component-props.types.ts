import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import type {
    BackupLogicHandler,
    BackupLogicState,
} from './backup-logic.types.ts'

export type BackupCreationProgressBridgeProps = {
    userId: string
}

export type BackupSettingsCardProps = {
    state: Pick<BackupLogicState, 'settings' | 'isSaving'>
    handler: Pick<
        BackupLogicHandler,
        'handleSettingsChange' | 'handleSaveSettings'
    >
}

export type BackupRestoreRowProps = {
    backupId: string
    columnCount: number
    state: Pick<
        BackupLogicState,
        'restoreBackupId' | 'restoreConfirmation' | 'activeActionId'
    >
    handler: Pick<
        BackupLogicHandler,
        | 'handleCancelRestore'
        | 'handleRestoreConfirmationChange'
        | 'handleRestoreBackup'
    >
}

export type BackupStatBadgeProps = {
    label: string
    value: number
    className: string
}

export type BackupSettingsSectionProps = {
    settings: BackupSettings
    onSettingsChange: BackupLogicHandler['handleSettingsChange']
}
