import { readFile } from 'node:fs/promises'

export const patchedPicomatchVersion = '4.0.7'
export const picomatchParserSha256 =
    '46c326dda81c8afdb936e69773d03a5233534ddfec054d74ce5bdb68ab8cc337'

export async function assertPicomatchSha256(
    file: URL | string,
    expected: string,
) {
    const bytes = await readFile(file)
    const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    if (digest !== expected) {
        throw new Error(
            'Unexpected picomatch patch or installed parser digest.',
        )
    }
}
