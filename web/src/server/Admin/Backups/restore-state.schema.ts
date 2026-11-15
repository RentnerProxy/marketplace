import { z } from 'zod'
export const restoreStateSchema = z
    .object({
        version: z.literal(1),
        status: z.enum(['running', 'completed', 'failed', 'recovery-required']),
        phase: z.enum([
            'preparing',
            'validating',
            'creating-recovery',
            'replacing-storage',
            'restoring-database',
            'finalizing',
            'rolling-back',
        ]),
        percent: z.number().int().min(0).max(100).nullable(),
        processedBytes: z.number().int().nonnegative().safe(),
        totalBytes: z.number().int().nonnegative().safe(),
        startedAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
    .superRefine(function (state, context) {
        if (
            (state.totalBytes === 0 && state.processedBytes !== 0) ||
            state.processedBytes > state.totalBytes
        ) {
            context.addIssue({
                code: 'custom',
                message: 'Der gespeicherte Restore-Fortschritt ist ungültig.',
            })
        }
    })
