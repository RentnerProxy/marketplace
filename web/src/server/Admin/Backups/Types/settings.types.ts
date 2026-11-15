import type { backupSettings } from '@/db/schema'
import type { Database } from '@/lib/Database/Types/database.types.ts'

export type BackupSettingsDatabase = Pick<
    Database,
    'insert' | 'select' | 'update'
>

export type StoredBackupSettings = typeof backupSettings.$inferSelect
