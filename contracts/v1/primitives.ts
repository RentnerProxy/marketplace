import { z } from 'zod'

export const contractVersion = '1.0.0'
export const protocolVersion = z.literal('1.0.0')
export const runtimeProfile = z
    .literal('rentnerproxy-linux-v1')
    .describe(
        'Native Linux appliance profile exercised on AMD64 and ARM64. Runtime compatibility is checked against the supported appliance profile at installation.',
    )
export const formatVersion = z
    .literal(1)
    .describe(
        'Wire version. Readers reject unknown versions and unknown fields. Changes to a closed shape, allowed value, or meaning require a new wire version after v1 stabilizes.',
    )

export const positiveInteger = z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
export const stateVersion = z.number().int().min(1).max(2_147_483_647)
export const recordId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
export const githubId = z.string().regex(/^[1-9][0-9]{0,19}$/)
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const commit = z.string().regex(/^[a-f0-9]{40}$/)
export const target = z.enum(['linux-amd64', 'linux-arm64'])
export const timestamp = z.iso
    .datetime({ precision: 3 })
    .describe(
        'UTC timestamp with exactly three fractional digits. Time and actor authority are verified by the caller.',
    )

function slug(maxLength: number) {
    return '[a-z](?:[a-z0-9-]{0,' + (maxLength - 2) + '}[a-z0-9])?'
}

export const namespace = z.string().regex(new RegExp('^' + slug(32) + '$'))
export const appId = z
    .string()
    .regex(new RegExp('^' + slug(32) + '\\.' + slug(64) + '$'))

// Package names are part of the immutable release identity. Build metadata
// would introduce distinct names with equal SemVer precedence.
const part = '(?:0|[1-9][0-9]{0,5})'
const prerelease = '(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
export const appVersion = z
    .string()
    .max(64)
    .regex(
        new RegExp(
            '^' +
                part +
                '\\.' +
                part +
                '\\.' +
                part +
                '(?:-' +
                prerelease +
                '(?:\\.' +
                prerelease +
                ')*)?$',
        ),
    )
const v1Protocol = '1\\.' + part + '\\.' + part
export const v1ProtocolVersion = z
    .string()
    .regex(new RegExp('^' + v1Protocol + '$'))
export const protocolRange = z
    .string()
    .regex(
        new RegExp('^>=' + v1Protocol + ' <(?:' + v1Protocol + '|2\\.0\\.0)$'),
    )
    .describe(
        'Inclusive minimum and exclusive maximum within protocol major 1. The minimum must be less than the maximum.',
    )

// Use Unicode scalar counts and exclude control characters in both validators.
export const displayName = z.string().regex(/^[^\p{Cc}\p{Cs}]{1,80}$/u)
export const summary = z.string().regex(/^[^\p{Cc}\p{Cs}]{1,400}$/u)
export const releaseNotes = z
    .string()
    .regex(/^(?:[^\p{Cc}\p{Cs}]|\n){1,2000}$/u)
const applicationPath = '[a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*'
export function packagePath(directory: string, extension: string) {
    return z
        .string()
        .max(240)
        .regex(
            new RegExp(
                '^' +
                    directory +
                    '/(?:' +
                    applicationPath +
                    '/)*' +
                    applicationPath +
                    '\\.(?:' +
                    extension +
                    ')$',
            ),
        )
}

export const archive = z.strictObject({
    sha256,
    sizeBytes: z.number().int().min(1).max(2_147_483_647),
})
export const sourceIdentity = z
    .strictObject({
        repositoryId: githubId,
        commit,
    })
    .describe('Immutable GitHub repository ID and exact source commit.')
