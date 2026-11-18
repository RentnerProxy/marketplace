import { z } from 'zod'
import { rpcLimits } from './http-operations.ts'
import { recordId } from './primitives.ts'

const loneSurrogate = /\p{Cs}/u

/** Admit decoded wire JSON, including own members that a shape validator may skip. */
export function isWireJson(value: unknown, depth = 0): boolean {
    if (value === null || typeof value === 'boolean') return true
    if (typeof value === 'number')
        return Math.abs(value) <= Number.MAX_SAFE_INTEGER
    if (typeof value === 'string') return !loneSurrogate.test(value)
    if (typeof value !== 'object' || depth >= rpcLimits.maxJsonDepth)
        return false
    if (Array.isArray(value)) {
        for (const item of value) {
            if (!isWireJson(item, depth + 1)) return false
        }
        return true
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.entries(value).every(
        ([key, member]) =>
            !loneSurrogate.test(key) && isWireJson(member, depth + 1),
    )
}

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
    .refine(({ type, code }) => type === 'urn:rentnerproxy:problem:' + code)
    .describe(
        'RFC 9457 problem with a stable machine code and no private error details. The type URN suffix equals code; on HTTP the status also equals the status line.',
    )

export const operation = z
    .discriminatedUnion('status', [
        z.looseObject({
            id: recordId,
            status: z.enum([
                'accepted',
                'running',
                'cancelling',
                'cancelled',
                'succeeded',
            ]),
            problem: z.never().optional(),
        }),
        z.looseObject({ id: recordId, status: z.literal('failed'), problem }),
    ])
    .describe(
        'Accepted work has a durable operation ID. Cancellation is an operation request. A disconnect or timeout does not confirm cancellation or rollback.',
    )
