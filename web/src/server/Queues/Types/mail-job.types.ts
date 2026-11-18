import type { z } from 'zod'
import type { mailJobDataSchema } from '../mail-job.schema.ts'

export type MailJobData = z.infer<typeof mailJobDataSchema>
export type StaffInvitationResendMailInput = Omit<
    Extract<MailJobData, { kind: 'staff-invitation-resend' }>,
    'kind'
>

export type MailJobEnvelope = {
    version: 1
    encryptedPayload: string
}
