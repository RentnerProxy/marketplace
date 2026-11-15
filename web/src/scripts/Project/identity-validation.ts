import { z } from 'zod'

const identifier = z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .refine((value) => !value.startsWith('pg_'))
    .refine(
        (value) =>
            ![
                'public',
                'drizzle',
                'information_schema',
                'pg_toast',
                'postgres',
                'template0',
                'template1',
                'none',
                'all',
                'current_user',
                'session_user',
            ].includes(value),
    )
const displayText = z
    .string()
    .min(1)
    .max(200)
    .refine((value) =>
        Array.from(value).every((character) => {
            const code = character.charCodeAt(0)
            return code >= 32 && code !== 127
        }),
    )
    .refine((value) => value === value.trim())

const projectConfigSchema = z.strictObject({
    defaultName: displayText,
    id: z
        .string()
        .regex(/^[a-z][a-z0-9_-]{0,39}$/)
        .optional(),
    packageName: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
    databaseName: identifier,
    databaseSchema: identifier,
    databaseRole: identifier.optional(),
    repositoryUrl: z.url().refine((value) => {
        const url = new URL(value)
        return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
        )
    }),
    imageRepository: z
        .string()
        .regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*$/),
    description: displayText,
})

export const projectIdentitySchema = projectConfigSchema
    .transform((config) => {
        const id = config.id ?? config.imageRepository.split('/').at(-1)
        return {
            ...config,
            id,
            databaseRole: config.databaseRole ?? `${id}_runtime`,
        }
    })
    .pipe(
        projectConfigSchema.extend({
            id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
            databaseRole: identifier,
        }),
    )

export function validateProjectIdentity(value: unknown) {
    const result = projectIdentitySchema.safeParse(value)
    if (!result.success) {
        throw new Error(
            `Ungültige Projektkonfiguration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        )
    }
    return result.data
}
