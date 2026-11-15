import { z } from 'zod'
const restoreIdentitySchema = z
    .object({
        startedAt: z.iso.datetime(),
        status: z.enum(['running', 'completed', 'failed', 'recovery-required']),
        updatedAt: z.iso.datetime(),
    })
    .strict()

const restoreBaselineSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('known'),
            state: restoreIdentitySchema.nullable(),
        })
        .strict(),
    z.object({ kind: z.literal('unknown') }).strict(),
])

const queueStateSchema = z
    .object({
        name: z.string().min(1),
        pendingJobIds: z.array(z.string().min(1)),
        wasPaused: z.boolean(),
    })
    .strict()

export const mailRestoreQuiescenceSchema = z
    .object({
        version: z.literal(1),
        token: z.uuid(),
        phase: z.enum(['pausing', 'paused', 'purged']),
        ownerLeaseUntil: z.number().int().nonnegative().safe(),
        restoreBaseline: restoreBaselineSchema,
        queues: z.array(queueStateSchema).min(1),
    })
    .strict()
