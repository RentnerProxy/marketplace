import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupRun } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import {
    BACKUP_ARCHIVE_EXTENSION,
    DEFAULT_BACKUP_SETTINGS,
} from '@/config/backup.config.ts'

export const settings: BackupSettings = {
    ...DEFAULT_BACKUP_SETTINGS,
    targetKey: 'local',
}
export const completedRun: BackupRun = {
    id: 'backup-1',
    trigger: 'manual',
    status: 'completed',
    fileName: `archive${BACKUP_ARCHIVE_EXTENSION}`,
    fileSize: 2048,
    includesStorage: true,
    errorMessage: null,
    startedAt: '2026-01-01T12:00:00Z',
}
