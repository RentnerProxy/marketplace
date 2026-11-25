export function createTokenHashSync(token: string) {
    return new Bun.CryptoHasher('sha256').update(token, 'utf8').digest('hex')
}

export async function createTokenHash(token: string) {
    return createTokenHashSync(token)
}
