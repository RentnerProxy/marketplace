import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import { isRecord } from '@/lib/Validation/isRecord.ts'
import { isIP } from 'node:net'
import { z } from 'zod'
import {
    isMissingEnvironmentValue,
    isUrlEncodable,
} from './environment-schema.service.ts'

const hostnameLabelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const invalidIpv4Pattern = /^\d+(?:\.\d+){3}$/

export const databaseUrlSchema = z
    .string()
    .trim()
    .superRefine(function (value, context) {
        try {
            const url = new URL(value)

            if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
                context.addIssue({
                    code: 'custom',
                    message:
                        'DATABASE_URL muss eines der Protokolle postgres:, postgresql: verwenden.',
                })
            }
        } catch {
            context.addIssue({
                code: 'custom',
                message: 'DATABASE_URL muss eine gültige URL sein.',
            })
        }
    })

const postgresHostSchema = z
    .string()
    .trim()
    .min(1, 'POSTGRES_HOST darf nicht leer sein.')
    .transform(normalizePostgresHost)
    .refine(
        isValidPostgresHost,
        'POSTGRES_HOST muss ein gültiger DNS-Hostname oder eine IP-Adresse sein.',
    )

const postgresPortSchema = z
    .string()
    .trim()
    .regex(
        /^[1-9]\d{0,4}$/,
        'POSTGRES_PORT muss eine ganze Zahl ohne führende Nullen sein.',
    )
    .refine(
        (value) => Number(value) <= 65_535,
        'POSTGRES_PORT muss zwischen 1 und 65535 liegen.',
    )

const postgresUserSchema = createUrlComponentSchema('POSTGRES_USER', 255)
const postgresPasswordSchema = z
    .string()
    .min(1, 'POSTGRES_PASSWORD darf nicht leer sein.')
    .max(4_096, 'POSTGRES_PASSWORD ist zu lang.')
    .refine(
        (value) => value.trim().length > 0,
        'POSTGRES_PASSWORD darf nicht nur aus Leerzeichen bestehen.',
    )
    .refine(
        (value) => !hasControlCharacters(value),
        'POSTGRES_PASSWORD darf keine Steuerzeichen enthalten.',
    )
    .refine(
        isUrlEncodable,
        'POSTGRES_PASSWORD enthält ungültige Unicode-Zeichen.',
    )
const postgresDatabaseSchema = createUrlComponentSchema('POSTGRES_DB', 255)

const postgresConnectionPartsSchema = z.object({
    POSTGRES_HOST: postgresHostSchema,
    POSTGRES_PORT: postgresPortSchema,
    POSTGRES_USER: postgresUserSchema,
    POSTGRES_PASSWORD: postgresPasswordSchema,
    POSTGRES_DB: postgresDatabaseSchema,
})

const databaseEnvironmentSchema = z.preprocess(
    resolveDatabaseUrlEnvironment,
    z.object({ DATABASE_URL: databaseUrlSchema }),
)

export function parseDatabaseEnvironment(environment: unknown) {
    return databaseEnvironmentSchema.parse(environment)
}

export function resolveDatabaseUrlEnvironment(environment: unknown) {
    if (!isRecord(environment)) {
        return environment
    }

    if (!isMissingEnvironmentValue(environment.DATABASE_URL)) {
        return environment
    }

    const connection = postgresConnectionPartsSchema.parse(environment)
    const host =
        isIP(connection.POSTGRES_HOST) === 6
            ? `[${connection.POSTGRES_HOST}]`
            : connection.POSTGRES_HOST
    const databaseUrl = databaseUrlSchema.parse(
        `postgresql://${encodeURIComponent(connection.POSTGRES_USER)}:${encodeURIComponent(connection.POSTGRES_PASSWORD)}@${host}:${connection.POSTGRES_PORT}/${encodeURIComponent(connection.POSTGRES_DB)}`,
    )

    return {
        ...environment,
        DATABASE_URL: databaseUrl,
    }
}

function createUrlComponentSchema(variableName: string, maxLength: number) {
    return z
        .string()
        .min(1, `${variableName} darf nicht leer sein.`)
        .max(maxLength, `${variableName} ist zu lang.`)
        .refine(
            (value) => value === value.trim(),
            `${variableName} darf keine äußeren Leerzeichen enthalten.`,
        )
        .refine(
            (value) => !hasControlCharacters(value),
            `${variableName} darf keine Steuerzeichen enthalten.`,
        )
        .refine(
            isUrlEncodable,
            `${variableName} enthält ungültige Unicode-Zeichen.`,
        )
}

function normalizePostgresHost(value: string) {
    if (!value.startsWith('[') && !value.endsWith(']')) {
        return value
    }

    if (value.startsWith('[') && value.endsWith(']')) {
        const unwrappedHost = value.slice(1, -1)

        if (isIP(unwrappedHost) === 6) {
            return unwrappedHost
        }
    }

    return value
}

function isValidPostgresHost(value: string) {
    if (isIP(value) !== 0) {
        return true
    }

    if (invalidIpv4Pattern.test(value)) {
        return false
    }

    return (
        value.length <= 253 &&
        value.split('.').every((label) => hostnameLabelPattern.test(label))
    )
}
