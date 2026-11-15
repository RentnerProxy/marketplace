export async function createTokenHash(token: string) {
    const tokenBytes = new TextEncoder().encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes)
    const hashBytes = Array.from(new Uint8Array(hashBuffer))

    return hashBytes
        .map(function (byte) {
            return byte.toString(16).padStart(2, '0')
        })
        .join('')
}
