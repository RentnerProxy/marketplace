import { z } from 'zod'
import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'
import { mailJobDataSchema } from './mail-job.schema.ts'
import type { MailJobData, MailJobEnvelope } from './Types/mail-job.types.ts'

const mailJobEnvelopeSchema = z.object({
    version: z.literal(1),
    encryptedPayload: z
        .string()
        .max(100_000)
        .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
})

export async function createMailJobEnvelope(
    data: MailJobData,
): Promise<MailJobEnvelope> {
    const validatedData = mailJobDataSchema.parse(data)

    return {
        version: 1 as const,
        encryptedPayload: await encryptAuthSecret(
            JSON.stringify(validatedData),
        ),
    }
}

export async function readMailJobEnvelope(
    value: unknown,
): Promise<MailJobData> {
    const envelope = mailJobEnvelopeSchema.safeParse(value)

    if (!envelope.success) {
        throw new Error('Mail-Job enthält keinen gültigen Payload-Umschlag.')
    }

    try {
        const decryptedPayload = await decryptAuthSecret(
            envelope.data.encryptedPayload,
        )
        return mailJobDataSchema.parse(JSON.parse(decryptedPayload))
    } catch {
        throw new Error('Mail-Job-Payload konnte nicht entschlüsselt werden.')
    }
}
