import { z } from 'zod'
import { appApiPayload } from './platform-api.ts'
import { positiveInteger, recordId } from './primitives.ts'
import { problem } from './wire.ts'

const binding = {
    installId: recordId,
    installationGeneration: positiveInteger.describe(
        'Installation generation assigned by the native manager.',
    ),
    generation: positiveInteger.describe(
        'Session channel generation. Each bootstrap increases it within the frame.',
    ),
}

const route = recordId.describe('Route ID from the host route allowlist.')

const ready = z
    .strictObject({
        type: z.literal('runtime:ready'),
        nonce: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/),
    })
    .describe(
        'The iframe targets the exact host origin and transfers one private document control port. The host checks the expected iframe WindowProxy, the opaque origin (the string "null"), and the nonce issued for this frame before accepting the port.',
    )

const bootstrap = z
    .strictObject({
        type: z.literal('runtime:bootstrap'),
        bridgeVersion: z.literal('1.0.0'),
        ...binding,
    })
    .describe(
        'The host selects the bridge version and transfers one fresh session port over the private document control port. Validate the port transfer separately from the payload.',
    )

const connected = z
    .strictObject({ type: z.literal('connected'), ...binding })
    .describe(
        'The iframe acknowledges the bootstrap on the active session port.',
    )

const context = z
    .strictObject({
        type: z.literal('context'),
        ...binding,
        theme: z.enum(['light', 'dark']),
        locale: z
            .string()
            .max(64)
            .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
        route,
        ready: z.boolean(),
    })
    .describe('The host sends current UI context on the active session port.')

const navigate = z
    .strictObject({ type: z.literal('navigate'), ...binding, route })
    .describe('The iframe requests a host route on the active session port.')

const dialog = z.strictObject({
    type: z.literal('dialog'),
    ...binding,
    requestId: recordId,
    dialogId: recordId.describe('A dialog declared by the installed app. The host controls rendering and focus.'),
})

const dialogResult = z.strictObject({
    type: z.literal('dialogResult'),
    ...binding,
    requestId: recordId,
    outcome: z.enum(['confirmed', 'cancelled']),
})

const apiRequest = z.strictObject({
    type: z.literal('apiRequest'),
    ...binding,
    requestId: recordId,
    operationId: recordId,
    idempotencyKey: recordId,
    payload: appApiPayload,
}).describe('Only call a declared operation through the authenticated app gateway with current permissions.')

const apiResult = z.strictObject({
    type: z.literal('apiResult'),
    ...binding,
    requestId: recordId,
    result: z.discriminatedUnion('ok', [
        z.strictObject({ ok: z.literal(true), payload: appApiPayload }),
        z.strictObject({ ok: z.literal(false), problem }),
    ]),
})

export const uiBridgeSchemas = {
    UiBridgeMessage: z
        .discriminatedUnion('type', [
            ready,
            bootstrap,
            connected,
            context,
            navigate,
            dialog,
            dialogResult,
            apiRequest,
            apiResult,
        ])
        .describe(
            'Check the transfer count and ports outside payload validation. Require the active session port and matching install ID, installation generation, and channel generation for session messages. Close replaced session ports and revoke both ports when the document or installation binding expires. Protected resource actions require the current installation generation and authorization through the authenticated gateway.',
        ),
}
