import type { CompleteRestoreQuiescence } from '@/server/Queues/Types/mail-restore-quiescence.types.ts'
import type { z } from 'zod'
import type { backupJobDataSchema } from '../backup.queue.ts'

export type BackupJobData = z.infer<typeof backupJobDataSchema>

export type StartBackupWorkerOptions = {
    isRestoreQuiescenceActive: () => Promise<boolean>
    runRestoreQuiesced: (
        operation: (
            completeRestoreQuiescence: CompleteRestoreQuiescence,
        ) => Promise<unknown>,
    ) => Promise<unknown>
}
