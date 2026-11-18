import { z } from 'zod'
import { commit } from '../../../../contracts/v1/primitives.ts'

export const repositoryName = z
    .string()
    .max(140)
    .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/,
    )
export const sourcePath = z
    .string()
    .max(200)
    .regex(/^(?:\.|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)$/)
    .refine(
        (value) =>
            value === '.' ||
            value
                .split('/')
                .every(
                    (part) =>
                        part !== '.' &&
                        part !== '..' &&
                        part.toLowerCase() !== '.git',
                ),
    )

export const sourceRequest = z.strictObject({
    repository: repositoryName,
    commit,
    path: sourcePath,
})
