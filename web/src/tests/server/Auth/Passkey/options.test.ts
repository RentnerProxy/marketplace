import { describe, expect, it } from 'bun:test'
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
} from '@simplewebauthn/server'
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { toSerializablePasskeyOptions } from '@/server/Auth/Passkey/options.ts'
import { toStoredTransports } from '@/server/Auth/Passkey/credential.ts'
import { createWebAuthnUserId } from '@/lib/Auth/passkeys.ts'

describe('Passkey-Optionen an der ServerFn-Grenze', function () {
    it('erzeugt eine WebAuthn-Benutzer-ID aus 32 zufälligen Bytes als Base64URL', function () {
        const userId = createWebAuthnUserId()
        expect(userId).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(Buffer.from(userId, 'base64url')).toHaveLength(32)
        expect(Buffer.from(userId, 'base64url').toString('base64url')).toBe(
            userId,
        )
        expect(createWebAuthnUserId()).not.toBe(userId)
    })

    it('erhält die echten Registrierungsoptionen samt credProps und Benutzerverifikation', async function () {
        const userID = Buffer.from([255, 1, 2, 3, 254]).subarray(1, 4)
        const generated = await generateRegistrationOptions({
            rpName: 'Test App',
            rpID: 'example.test',
            userName: 'user@example.test',
            userID,
            authenticatorSelection: { userVerification: 'required' },
            excludeCredentials: [{ id: 'AQID', transports: ['internal'] }],
        })
        const options = toSerializablePasskeyOptions(
            generated,
        ) satisfies PublicKeyCredentialCreationOptionsJSON

        expect(generated).toEqual(options)
        expect(options.user.id).toBe('AQID')
        expect(options.timeout).toBe(60_000)
        expect(options.extensions).toEqual({ credProps: true })
        expect(options.authenticatorSelection?.userVerification).toBe(
            'required',
        )
        expect(JSON.parse(JSON.stringify(options))).toEqual(
            JSON.parse(JSON.stringify(generated)),
        )
    })

    it('erhält Challenge, RP und Transporthinweise der echten Anmeldeoptionen', async function () {
        const transports = toStoredTransports(['usb', 'hybrid', 'future', ''])
        const generated = await generateAuthenticationOptions({
            rpID: 'example.test',
            userVerification: 'required',
            allowCredentials: [{ id: 'AQID', transports }],
        })
        const options = toSerializablePasskeyOptions(
            generated,
        ) satisfies PublicKeyCredentialRequestOptionsJSON

        expect(transports).toEqual(['usb', 'hybrid', 'future'])
        expect(generated).toEqual(options)
        expect(options.timeout).toBe(60_000)
        expect(options.allowCredentials?.[0].transports).toEqual(transports)
        expect(JSON.parse(JSON.stringify(options))).toEqual(
            JSON.parse(JSON.stringify(generated)),
        )
    })

    it('weist binäre PRF-Extensions vor einer verlustbehafteten Übertragung zurück', function () {
        expect(function () {
            toSerializablePasskeyOptions({
                challenge: 'AQID',
                extensions: { prf: { eval: { first: new Uint8Array([1]) } } },
            })
        }).toThrow()
    })
})
