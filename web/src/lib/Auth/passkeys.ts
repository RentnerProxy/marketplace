export function createWebAuthnUserId() {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)

    return Buffer.from(bytes).toString('base64url')
}
