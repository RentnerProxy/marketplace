import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'

export const coreErrorSchema = z
    .object({
        code: z.string().regex(/^[A-Z0-9_]{1,100}$/),
        message: z.string().min(1).max(2000),
    })
    .strict()

export const coreResultFrameSchema = z
    .object({ type: z.literal('result'), result: z.unknown() })
    .strict()

export const coreBinaryResultFrameSchema = z
    .object({
        type: z.literal('binaryResult'),
        binaryBytes: z
            .number()
            .int()
            .min(0)
            .max(CORE_RUNTIME.maxBinaryOutputBytes),
        version: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()

export const coreErrorFrameSchema = z
    .object({ type: z.literal('error'), error: coreErrorSchema })
    .strict()

export const coreSuccessSchema = z.object({ ok: z.literal(true) }).strict()
