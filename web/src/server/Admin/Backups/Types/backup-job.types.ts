import type { backupJobDataSchema } from '@/server/Admin/Backups/backup.queue.ts'
import type { z } from 'zod'
export type BackupJobData = z.infer<typeof backupJobDataSchema>
