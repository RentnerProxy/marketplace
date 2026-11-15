import type { z } from 'zod'
import type { mailJobDataSchema } from '../mail-job.schema.ts'

export type MailJobData = z.infer<typeof mailJobDataSchema>

export type MailJobEnvelope = {
    version: 1
    encryptedPayload: string
}
