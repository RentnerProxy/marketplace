import { z } from 'zod'
import { recordId } from './primitives.ts'

export const problem = z
    .strictObject({
        type: z
            .string()
            .regex(/^urn:rentnerproxy:problem:[a-z][a-zA-Z0-9]{0,63}$/),
        title: z.string().min(1).max(120),
        status: z.number().int().min(400).max(599),
        code: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
        requestId: recordId,
    })
    .describe(
        'RFC 9457 problem with stable machine code and no private error details.',
    )

export const operation = z
    .discriminatedUnion('status', [
        z.strictObject({
            id: recordId,
            status: z.enum([
                'accepted',
                'running',
                'cancelling',
                'cancelled',
                'succeeded',
            ]),
        }),
        z.strictObject({ id: recordId, status: z.literal('failed'), problem }),
    ])
    .describe(
        'Accepted work has a durable operation ID. Cancellation is an operation request. A disconnect or timeout does not confirm cancellation or rollback.',
    )
