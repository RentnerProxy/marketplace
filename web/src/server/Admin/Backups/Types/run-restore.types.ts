import type { backupRuns } from '@/db/schema'

export type BackupRunRecord = typeof backupRuns.$inferSelect
