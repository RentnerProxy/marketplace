import type { BackupJobData } from '@/server/Admin/Backups/Types/backup-worker.types.ts'
import {
    backupFailureJobDataSchema,
    backupJobDataSchema,
} from './backup.queue.ts'

import { executeCreateBackup } from './run-create.service.ts'
import { executeRestoreBackup } from './run-restore.service.ts'
import { markRunAsQueueFailed } from './run-registry.service.ts'
import type { BackupJobExecutionOptions } from './Types/backup-service.types.ts'

export async function processBackupJob(
    job: BackupJobData,
    options: BackupJobExecutionOptions = {},
) {
    const validatedJob = backupJobDataSchema.parse(job)

    if (validatedJob.kind === 'restore') {
        return executeRestoreBackup(validatedJob, {
            completeRestoreQuiescence: options.completeRestoreQuiescence,
            reportProgress: options.reportProgress,
        })
    }

    return executeCreateBackup(validatedJob, {
        deferFailureToQueue: true,
        reportProgress: options.reportProgress,
    })
}

export async function reconcileFailedBackupJob(
    jobData: unknown,
    error: unknown,
) {
    const parsedJob = backupFailureJobDataSchema.safeParse(jobData)

    if (!parsedJob.success || !parsedJob.data.runId) {
        return
    }

    await markRunAsQueueFailed(parsedJob.data.runId, error)
}
