import { z } from 'zod'
import {
    encryptionKeySchema,
    normalizeOptionalEnvironmentValue,
    optionalEnvironmentValue,
    valkeyUrlSchema,
} from './environment-schema.service.ts'
import { resolveValkeyUrlEnvironment } from './valkey-environment.service.ts'

const optionalMailAddressSchema = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z.email().optional(),
)
const smtpPortSchema = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z
        .string()
        .regex(/^\d+$/, 'SMTP_PORT muss eine ganze Zahl sein.')
        .refine(
            (value) => Number(value) >= 1 && Number(value) <= 65_535,
            'SMTP_PORT muss zwischen 1 und 65535 liegen.',
        )
        .default('587'),
)
const smtpSecureSchema = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z.enum(['true', 'false']).default('false'),
)

const mailWorkerEnvironmentSchema = z
    .object({
        VALKEY_URL: valkeyUrlSchema,
        AUTH_ENCRYPTION_KEY: encryptionKeySchema,
        SMTP_HOST: optionalEnvironmentValue,
        SMTP_PORT: smtpPortSchema,
        SMTP_SECURE: smtpSecureSchema,
        SMTP_USER: optionalEnvironmentValue,
        SMTP_PASSWORD: optionalEnvironmentValue,
        MAIL_FROM: optionalMailAddressSchema,
    })
    .superRefine(function (environment, context) {
        for (const key of [
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
            'SMTP_PASSWORD',
            'MAIL_FROM',
        ] as const) {
            if (!environment[key]) {
                context.addIssue({
                    code: 'custom',
                    path: [key],
                    message: `${key} wird für den SMTP-Mailversand benötigt.`,
                })
            }
        }
    })

export function parseMailWorkerEnvironment(environment: unknown) {
    return mailWorkerEnvironmentSchema.parse(
        resolveValkeyUrlEnvironment(environment),
    )
}
