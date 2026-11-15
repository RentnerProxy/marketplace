import { z } from 'zod'
import { webAuthnResponseSchema } from '@/lib/Validation/zodSchemas.ts'

const responseSchema = webAuthnResponseSchema.extend({
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
})

export const registrationResponseSchema = responseSchema.extend({
    response: z.looseObject({
        clientDataJSON: z.string(),
        attestationObject: z.string(),
        authenticatorData: z.string().optional(),
        transports: z.array(z.string()).optional(),
        publicKeyAlgorithm: z.number().optional(),
        publicKey: z.string().optional(),
    }),
})

export const authenticationResponseSchema = responseSchema.extend({
    response: z.looseObject({
        clientDataJSON: z.string(),
        authenticatorData: z.string(),
        signature: z.string(),
        userHandle: z.string().optional(),
    }),
})
