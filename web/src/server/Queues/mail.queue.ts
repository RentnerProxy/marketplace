import { Queue } from 'bullmq'
import type {
    AuthMailInput,
    FailedLoginAlertMailInput,
    SecurityChangeMailInput,
} from '@/lib/Mail/Types/mail-domain.types.ts'
import { getBullMqProducerConnectionOptions } from '@/server/Valkey/valkey.service.ts'
import {
    mailJobDataSchema,
    securityChangeMailInputSchema,
} from './mail-job.schema.ts'
import { createMailJobEnvelope } from './mail-payload.ts'
import type { MailJobData, MailJobEnvelope } from './Types/mail-job.types.ts'

export const MAIL_QUEUE_NAME = 'rentnerproxy-marketplace-mail-v2'

function createMailQueue() {
    return new Queue<MailJobEnvelope>(MAIL_QUEUE_NAME, {
        connection: getBullMqProducerConnectionOptions(),
        defaultJobOptions: {
            attempts: 5,
            backoff: {
                delay: 5_000,
                type: 'exponential',
            },
            removeOnComplete: 1_000,
            removeOnFail: 1_000,
        },
    })
}

declare global {
    var appMailQueueV2: ReturnType<typeof createMailQueue> | undefined
}

function getMailQueue() {
    globalThis.appMailQueueV2 ??= createMailQueue()
    return globalThis.appMailQueueV2
}

async function enqueueMailJob(data: MailJobData) {
    const validatedData = mailJobDataSchema.parse(data)
    const envelope = await createMailJobEnvelope(validatedData)

    if (validatedData.kind === 'security-change') {
        await getMailQueue().add(validatedData.kind, envelope, {
            jobId: crypto.randomUUID(),
        })
        return
    }

    await getMailQueue().add(validatedData.kind, envelope)
}

export async function enqueuePasswordResetMail(input: AuthMailInput) {
    await enqueueMailJob({
        ...input,
        kind: 'password-reset',
    })
}

export async function enqueueRegistrationVerificationMail(
    input: AuthMailInput,
) {
    await enqueueMailJob({ ...input, kind: 'registration-verification' })
}

export async function enqueuePasswordSetupMail(input: AuthMailInput) {
    await enqueueMailJob({
        ...input,
        kind: 'password-setup',
    })
}

export async function enqueueFailedLoginAlertMail(
    input: FailedLoginAlertMailInput,
) {
    await enqueueMailJob({
        ...input,
        kind: 'failed-login-alert',
    })
}

export async function enqueueSecurityChangeMail(
    input: SecurityChangeMailInput,
): Promise<void> {
    const validatedInput = securityChangeMailInputSchema.parse(input)
    await enqueueMailJob({
        ...validatedInput,
        kind: 'security-change',
    })
}
