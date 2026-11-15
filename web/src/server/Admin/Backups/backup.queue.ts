import type { BackupJobData } from '@/server/Admin/Backups/Types/backup-job.types.ts'
import { Queue } from 'bullmq'
import {
    BACKUP_CREATE_JOB_OPTIONS,
    BACKUP_QUEUE_NAME,
    BACKUP_SCHEDULER_ID,
} from '@/config/backup.config.ts'
import { getBullMqProducerConnectionOptions } from '@/server/Valkey/valkey.service.ts'
import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import { z } from 'zod'
import {
    assertValidBackupTimezoneService,
    getBackupRepeatOptionsService,
} from './backup-schedule.service.ts'

export const backupJobDataSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('create'),
            runId: z.uuid().optional(),
            trigger: z.enum(['manual', 'scheduled']),
        })
        .strict(),
    z
        .object({
            contractVersion: z.literal(2),
            kind: z.literal('restore'),
            runId: z.uuid(),
            sourceBackupId: z.uuid(),
        })
        .strict(),
])

export const backupFailureJobDataSchema = z.union([
    backupJobDataSchema,
    z
        .object({
            kind: z.literal('restore'),
            runId: z.uuid(),
            sourceBackupId: z.uuid(),
        })
        .strict(),
])

export function parseBackupJobContract(name: string, data: unknown) {
    const parsedJob = backupJobDataSchema.parse(data)
    const expectedName =
        parsedJob.kind === 'restore'
            ? 'restore-backup'
            : parsedJob.trigger === 'scheduled'
              ? 'scheduled-backup'
              : 'manual-backup'

    if (name !== expectedName) {
        throw new Error(
            'Backup-Jobname und Backup-Jobtyp stimmen nicht überein.',
        )
    }

    return parsedJob
}

function createBackupQueue() {
    return new Queue<BackupJobData>(BACKUP_QUEUE_NAME, {
        connection: getBullMqProducerConnectionOptions(),
        defaultJobOptions: {
            ...BACKUP_CREATE_JOB_OPTIONS,
            removeOnComplete: 200,
            removeOnFail: 500,
        },
    })
}

declare global {
    var appBackupQueue: ReturnType<typeof createBackupQueue> | undefined
}

export function getBackupQueue() {
    globalThis.appBackupQueue ??= createBackupQueue()
    return globalThis.appBackupQueue
}

export async function getNextScheduledBackupAt() {
    const scheduler =
        await getBackupQueue().getJobScheduler(BACKUP_SCHEDULER_ID)
    return scheduler?.next ? new Date(scheduler.next) : null
}

export async function syncBackupScheduler(settings: BackupSettings) {
    const queue = getBackupQueue()

    if (!settings.isEnabled) {
        await queue.removeJobScheduler(BACKUP_SCHEDULER_ID)
        return
    }

    const timezone = process.env.BACKUP_TIMEZONE?.trim() || 'Europe/Berlin'

    assertValidBackupTimezoneService(timezone)

    const repeat = getBackupRepeatOptionsService(settings, timezone)

    await queue.upsertJobScheduler(BACKUP_SCHEDULER_ID, repeat, {
        name: 'scheduled-backup',
        data: {
            kind: 'create',
            trigger: 'scheduled',
        },
        opts: BACKUP_CREATE_JOB_OPTIONS,
    })
}
