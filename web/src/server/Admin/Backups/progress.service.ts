import type { BackupJobData } from '@/server/Admin/Backups/Types/backup-job.types.ts'
import type { BackupRunRecord } from '@/server/Admin/Backups/Types/run-restore.types.ts'
import { z } from 'zod'
import { getStoredBackupErrorMessageService } from './error.service.ts'
import type { Job } from 'bullmq'
import type {
    BackupCreationProgress,
    BackupCreationProgressPhase,
} from '@/lib/Backups/Types/backup.types.ts'
import { backupJobDataSchema, getBackupQueue } from './backup.queue.ts'

import {
    getActiveCreateBackupRun,
    getBackupRunById,
} from './run-registry.service.ts'

const storedBackupCreationProgressSchema = z
    .object({
        version: z.literal(1),
        phase: z.enum([
            'preparing',
            'collecting',
            'archiving',
            'verifying',
            'finalizing',
        ]),
        processedBytes: z.number().int().nonnegative().safe(),
        totalBytes: z.number().int().nonnegative().safe(),
    })
    .strict()
    .superRefine(function (progress, context) {
        if (
            (progress.totalBytes === 0 && progress.processedBytes !== 0) ||
            progress.processedBytes > progress.totalBytes
        ) {
            context.addIssue({
                code: 'custom',
                message: 'Der gespeicherte Backup-Fortschritt ist ungültig.',
            })
        }
    })

function isCreateBackupRun(
    run: BackupRunRecord,
): run is BackupRunRecord & { trigger: 'manual' | 'scheduled' } {
    return run.trigger === 'manual' || run.trigger === 'scheduled'
}

function isKnownRunStatus(
    status: string,
): status is 'queued' | 'running' | 'completed' | 'failed' {
    return ['queued', 'running', 'completed', 'failed'].includes(status)
}

function isJobForRun(job: Job<BackupJobData>, runId: string) {
    const parsedJob = backupJobDataSchema.safeParse(job.data)
    return (
        parsedJob.success &&
        parsedJob.data.kind === 'create' &&
        parsedJob.data.runId === runId
    )
}

async function findBackupJob(runId: string) {
    const queue = getBackupQueue()
    const directJob = await queue.getJob(runId)

    if (directJob && isJobForRun(directJob, runId)) {
        return directJob
    }

    const jobs = await queue.getJobs(['active'], 0, 9, true)
    return jobs.find((job) => isJobForRun(job, runId)) ?? null
}

function getStoredProgress(job: Job<BackupJobData> | null) {
    const parsedProgress = storedBackupCreationProgressSchema.safeParse(
        job?.progress,
    )
    return parsedProgress.success ? parsedProgress.data : null
}

function getFallbackProgress(run: BackupRunRecord) {
    const terminalBytes = run.status === 'completed' ? (run.fileSize ?? 0) : 0
    const phase: BackupCreationProgressPhase =
        run.status === 'queued'
            ? 'queued'
            : run.status === 'completed'
              ? 'finalizing'
              : 'preparing'

    return {
        phase,
        processedBytes: terminalBytes,
        totalBytes: terminalBytes,
    }
}

export async function getBackupCreationProgressService(runId?: string) {
    const run = runId
        ? await getBackupRunById(runId)
        : await getActiveCreateBackupRun()

    if (!run || !isCreateBackupRun(run) || !isKnownRunStatus(run.status)) {
        return null
    }

    let storedProgress: BackupCreationProgress | null = null

    try {
        storedProgress = getStoredProgress(await findBackupJob(run.id))
    } catch {
        storedProgress = null
    }

    const progress =
        run.status === 'running'
            ? (storedProgress ?? getFallbackProgress(run))
            : getFallbackProgress(run)

    return {
        runId: run.id,
        trigger: run.trigger,
        status: run.status,
        phase: progress.phase,
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
        fileName: run.fileName,
        errorMessage: getStoredBackupErrorMessageService(run.errorMessage),
    }
}
