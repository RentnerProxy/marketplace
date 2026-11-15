import { z } from 'zod'
import { parseValkeyUrl } from '@/server/Valkey/valkeyUrl.ts'

export function isMissingEnvironmentValue(value: unknown) {
    return (
        value === undefined ||
        (typeof value === 'string' && value.trim() === '')
    )
}

export function isUrlEncodable(value: string) {
    try {
        encodeURIComponent(value)
        return true
    } catch {
        return false
    }
}

export function normalizeOptionalEnvironmentValue(value: unknown) {
    if (typeof value !== 'string') {
        return value
    }

    const normalizedValue = value.trim()
    return normalizedValue === '' ? undefined : normalizedValue
}

export const optionalEnvironmentValue = z.preprocess(
    normalizeOptionalEnvironmentValue,
    z.string().trim().optional(),
)

export function createUrlSchema(
    variableName: string,
    allowedProtocols: ReadonlyArray<string>,
) {
    return z
        .string()
        .trim()
        .superRefine(function (value, context) {
            try {
                const url = new URL(value)

                if (!allowedProtocols.includes(url.protocol)) {
                    context.addIssue({
                        code: 'custom',
                        message: `${variableName} muss eines der Protokolle ${allowedProtocols.join(', ')} verwenden.`,
                    })
                }
            } catch {
                context.addIssue({
                    code: 'custom',
                    message: `${variableName} muss eine gültige URL sein.`,
                })
            }
        })
}

export const valkeyUrlSchema = createUrlSchema('VALKEY_URL', [
    'redis:',
    'rediss:',
]).superRefine(function (value, context) {
    try {
        parseValkeyUrl(value)
    } catch (error) {
        context.addIssue({
            code: 'custom',
            message:
                error instanceof Error
                    ? error.message
                    : 'VALKEY_URL ist ungültig.',
        })
    }
})

export const encryptionKeySchema = z
    .string()
    .trim()
    .refine(function (value) {
        try {
            const decoded = Buffer.from(value, 'base64')
            return decoded.length === 32 && decoded.toString('base64') === value
        } catch {
            return false
        }
    }, 'AUTH_ENCRYPTION_KEY muss ein Base64-kodierter 32-Byte-Schlüssel sein.')
