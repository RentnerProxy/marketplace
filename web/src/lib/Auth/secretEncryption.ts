import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'

async function getEncryptionKey() {
    const keyBytes = Buffer.from(
        getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
        'base64',
    )

    if (keyBytes.byteLength !== 32) {
        throw new Error(
            'AUTH_ENCRYPTION_KEY muss ein 32-Byte-Base64-Schlüssel sein.',
        )
    }

    return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
    ])
}

export async function encryptAuthSecret(secret: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
            tagLength: 16 * 8,
        },
        await getEncryptionKey(),
        new TextEncoder().encode(secret),
    )

    return [
        'v1',
        Buffer.from(iv).toString('base64url'),
        Buffer.from(encrypted).toString('base64url'),
    ].join('.')
}

export async function decryptAuthSecret(value: string) {
    const parts = value.split('.')
    const [version, ivValue, encryptedValue] = parts
    if (
        parts.length !== 3 ||
        version !== 'v1' ||
        !ivValue ||
        !encryptedValue ||
        !/^[A-Za-z0-9_-]+$/.test(ivValue) ||
        !/^[A-Za-z0-9_-]+$/.test(encryptedValue)
    ) {
        throw new Error('Ungültiger verschlüsselter Auth-Secret-Umschlag.')
    }

    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    if (
        iv.byteLength !== 12 ||
        encrypted.byteLength < 16 ||
        iv.toString('base64url') !== ivValue ||
        encrypted.toString('base64url') !== encryptedValue
    ) {
        throw new Error('Ungültiger verschlüsselter Auth-Secret-Umschlag.')
    }

    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv,
            tagLength: 16 * 8,
        },
        await getEncryptionKey(),
        encrypted,
    )

    return new TextDecoder('utf-8', { fatal: true }).decode(decrypted)
}
