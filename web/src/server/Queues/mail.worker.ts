import { Worker } from 'bullmq'
import {
    sendPasswordResetMail,
    sendPasswordSetupMail,
    sendFailedLoginAlertMail,
    sendSecurityChangeMail,
} from '@/lib/Mail/mail.ts'
import { getBullMqConnectionOptions } from '@/server/Valkey/valkey.service.ts'
import { MAIL_QUEUE_NAME } from './mail.queue.ts'
import { readMailJobEnvelope } from './mail-payload.ts'
import type { MailJobData, MailJobEnvelope } from './Types/mail-job.types.ts'
import type { MailJob } from './Types/mail-worker.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createSafeErrorForStorageService } from '@/server/Logging/error-details.ts'
import { createMailRestoreQuiescenceService } from './mail-restore-quiescence.service.ts'
import { isRestoreStateActiveService } from '@/server/Admin/Backups/restore-state.service.ts'
import { createQueueWorkerLifecycleService } from '@/server/Runtime/queue-worker-lifecycle.service.ts'
import { waitForWorkerCleanupService } from '@/server/Runtime/worker-cleanup.service.ts'

async function dispatchMailJob(parsedJob: MailJobData) {
    if (await isRestoreStateActiveService()) {
        throw new Error(
            'Mailversand bleibt während einer Wiederherstellung pausiert.',
        )
    }

    switch (parsedJob.kind) {
        case 'security-change':
            await sendSecurityChangeMail({
                to: parsedJob.to,
                change: parsedJob.change,
                changedAt: parsedJob.changedAt,
                auditEventId: parsedJob.auditEventId,
            })
            return
        case 'failed-login-alert':
            await sendFailedLoginAlertMail(parsedJob)
            return
        case 'password-setup':
            await sendPasswordSetupMail(parsedJob)
            return
        case 'password-reset':
            await sendPasswordResetMail(parsedJob)
            return
    }
}

export async function processMailJob(job: MailJob) {
    try {
        const parsedJob = await readMailJobEnvelope(job.data)

        if (job.name !== parsedJob.kind) {
            throw new Error(
                'Mail-Jobname und Mail-Jobtyp stimmen nicht überein.',
            )
        }

        await dispatchMailJob(parsedJob)
    } catch (error) {
        throw createSafeErrorForStorageService(
            error,
            'Mail-Job konnte nicht verarbeitet werden.',
        )
    }
}

function getMailJobIdForLogging(value: unknown) {
    if (typeof value !== 'string') {
        return undefined
    }

    if (
        value.length >= 1 &&
        value.length <= 20 &&
        !/\D/u.test(value) &&
        (value === '0' || value[0] !== '0')
    ) {
        return value
    }

    return value.length === 36 &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
            value,
        )
        ? value
        : undefined
}

function getMailJobNameForLogging(value: unknown) {
    switch (value) {
        case 'failed-login-alert':
        case 'password-reset':
        case 'password-setup':
        case 'security-change':
            return value
        default:
            return undefined
    }
}

function attachMailWorkerLogging(
    worker: Worker,
    queueName: typeof MAIL_QUEUE_NAME,
) {
    worker.on('failed', function (job, error) {
        logError('mail.job.failed', error, {
            jobId: getMailJobIdForLogging(job?.id),
            jobName: getMailJobNameForLogging(job?.name),
            queueName,
        })
    })

    worker.on('error', function (error) {
        logError('mail.worker.error', error, { queueName })
    })
}

export async function startMailWorker() {
    const lifecycle = createQueueWorkerLifecycleService(MAIL_QUEUE_NAME)
    const restoreQuiescence = createMailRestoreQuiescenceService({
        queueNames: [MAIL_QUEUE_NAME],
    })

    async function closeRestoreQuiescence() {
        if (!(await waitForWorkerCleanupService(restoreQuiescence.close()))) {
            throw new Error('Mail-Queue-Cleanup konnte nicht beendet werden.')
        }
    }

    try {
        await restoreQuiescence.reconcileStartup()
        restoreQuiescence.startValkeyRecovery()
    } catch (error) {
        await restoreQuiescence.close()
        throw error
    }

    const workerV2 = new Worker<MailJobEnvelope>(
        MAIL_QUEUE_NAME,
        async function (job) {
            await lifecycle.runJob(() => processMailJob(job))
        },
        {
            concurrency: 5,
            connection: getBullMqConnectionOptions(),
        },
    )

    attachMailWorkerLogging(workerV2, MAIL_QUEUE_NAME)

    return {
        close: async function (this: void) {
            try {
                await lifecycle.close(workerV2)
            } finally {
                await closeRestoreQuiescence()
            }
        },
        isRestoreQuiescenceActive: restoreQuiescence.isRestoreQuiescenceActive,
        isRestoreQuiescenceHealthyPaused:
            restoreQuiescence.isRestoreQuiescenceHealthyPaused,
        isRunning: function (this: void) {
            return workerV2.isRunning()
        },
        runRestoreQuiesced: restoreQuiescence.runRestoreQuiesced,
    }
}
