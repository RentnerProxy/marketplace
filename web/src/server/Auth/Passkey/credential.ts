import type { passkeyCredentials } from '@/db/schema.ts'

export function toStoredTransports(transports?: Array<string>): Array<string> {
    return (transports ?? []).filter(Boolean)
}

export function toCredential(passkey: typeof passkeyCredentials.$inferSelect) {
    return {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: toStoredTransports(passkey.transports),
    }
}
