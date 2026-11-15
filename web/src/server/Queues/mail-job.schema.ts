import { z } from 'zod'
import { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'

const mailRecipientSchema = z.object({
    to: z.string().trim().pipe(z.email().max(255)),
    username: z.string().trim().min(1).max(50),
})

const authMailJobSchema = mailRecipientSchema.extend({
    resetLink: z.url().max(2048),
})
const ipAddressSchema = z.union([z.ipv4(), z.ipv6()])

const changedAtSchema = z
    .string()
    .length(24)
    .pipe(z.iso.datetime({ precision: 3 }))
    .refine((value) => {
        const timestamp = Date.parse(value)
        return (
            Number.isFinite(timestamp) &&
            new Date(timestamp).toISOString() === value
        )
    })

export const securityChangeMailInputSchema = z.strictObject({
    to: z.string().trim().pipe(z.email().max(255)),
    change: z.enum(SECURITY_CHANGE_TYPES),
    changedAt: changedAtSchema,
    auditEventId: z.string().length(36).pipe(z.uuid()),
})

export const mailJobDataSchema = z.discriminatedUnion('kind', [
    authMailJobSchema.extend({ kind: z.literal('password-reset') }),
    authMailJobSchema.extend({ kind: z.literal('password-setup') }),
    mailRecipientSchema.extend({
        kind: z.literal('failed-login-alert'),
        ip: ipAddressSchema.nullable(),
        location: z.string().max(255).nullable(),
        device: z.string().max(255).nullable(),
        browser: z.string().max(255).nullable(),
        attemptedAt: z.string().min(1).max(100),
        mapsLink: z.url().max(2048).nullable(),
    }),
    securityChangeMailInputSchema.extend({
        kind: z.literal('security-change'),
    }),
])
