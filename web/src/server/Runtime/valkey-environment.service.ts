import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import { isRecord } from '@/lib/Validation/isRecord.ts'
import { z } from 'zod'
import {
    isUrlEncodable,
    valkeyUrlSchema,
} from './environment-schema.service.ts'
import { readValkeyPasswordFileService } from './valkey-password-file.service.ts'

const valkeyPasswordSchema = z
    .string()
    .min(1, 'VALKEY_PASSWORD darf nicht leer sein.')
    .max(4_096, 'VALKEY_PASSWORD ist zu lang.')
    .refine(
        (value) => value.trim().length > 0,
        'VALKEY_PASSWORD darf nicht nur aus Leerzeichen bestehen.',
    )
    .refine(
        (value) => !hasControlCharacters(value),
        'VALKEY_PASSWORD darf keine Steuerzeichen enthalten.',
    )
    .refine(
        isUrlEncodable,
        'VALKEY_PASSWORD enthält ungültige Unicode-Zeichen.',
    )

export function resolveValkeyUrlEnvironment(environment: unknown) {
    if (!isRecord(environment)) {
        return environment
    }

    const password =
        normalizeValkeyPassword(environment.VALKEY_PASSWORD) ??
        readValkeyPasswordFileService(environment.VALKEY_PASSWORD_FILE)
    const valkeyUrl = new URL(valkeyUrlSchema.parse(environment.VALKEY_URL))
    if (password !== undefined) {
        valkeyUrl.password = encodeURIComponent(
            valkeyPasswordSchema.parse(password),
        )
    }

    valkeyPasswordSchema.parse(decodeURIComponent(valkeyUrl.password))

    if (password === undefined) {
        return environment
    }

    return {
        ...environment,
        VALKEY_URL: valkeyUrl.toString(),
    }
}

function normalizeValkeyPassword(value: unknown) {
    return typeof value === 'string' && value !== '' ? value : undefined
}
