import { z } from 'zod'
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'

const serializableExtensionsSchema = z
    .strictObject({
        appid: z.string().optional(),
        credProps: z.boolean().optional(),
        hmacCreateSecret: z.boolean().optional(),
        minPinLength: z.boolean().optional(),
    })
    .optional()

export function toSerializablePasskeyOptions<
    T extends
        | PublicKeyCredentialCreationOptionsJSON
        | PublicKeyCredentialRequestOptionsJSON,
>(options: T) {
    const { extensions, ...rest } = options

    return {
        ...rest,
        extensions: serializableExtensionsSchema.parse(extensions),
    }
}
