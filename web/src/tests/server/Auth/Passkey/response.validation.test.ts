import { describe, expect, it } from 'bun:test'
import {
    authenticationResponseSchema,
    registrationResponseSchema,
} from '@/server/Auth/Passkey/response.validation.ts'

const credential = {
    id: 'Y3JlZGVudGlhbA',
    rawId: 'Y3JlZGVudGlhbA',
    type: 'public-key' as const,
    clientExtensionResults: { credProps: { rk: true } },
    authenticatorAttachment: 'platform' as const,
}

describe('Passkey-Antworten an der SDK-Grenze', () => {
    it('erhält gültige Registrierung und zukünftige Transportnamen', () => {
        const value = {
            ...credential,
            response: {
                clientDataJSON: 'AQID',
                attestationObject: 'BAUG',
                transports: ['internal', 'future-transport'],
                extra: 'preserved',
            },
        }
        expect(registrationResponseSchema.parse(value)).toEqual(value)
    })
    it('erhält gültige Anmeldung und Benutzerbindung', () => {
        const value = {
            ...credential,
            response: {
                clientDataJSON: 'AQID',
                authenticatorData: 'BAUG',
                signature: 'BwgJ',
                userHandle: 'dXNlcg',
            },
        }
        expect(authenticationResponseSchema.parse(value)).toEqual(value)
    })
    it.each(
        [
            null,
            [],
            {},
            { clientDataJSON: 42 },
            { clientDataJSON: 'AQID', signature: null },
        ].map((response) => ({ response })),
    )('weist beschädigte Nachweisdaten zurück: %j', ({ response }) => {
        expect(
            registrationResponseSchema.safeParse({ ...credential, response })
                .success,
        ).toBe(false)
        expect(
            authenticationResponseSchema.safeParse({ ...credential, response })
                .success,
        ).toBe(false)
    })
    it('weist einen nicht unterstützten Authenticator-Typ zurück', () => {
        expect(
            registrationResponseSchema.safeParse({
                ...credential,
                authenticatorAttachment: 'invalid',
                response: { clientDataJSON: 'AQID', attestationObject: 'BAUG' },
            }).success,
        ).toBe(false)
    })
})
