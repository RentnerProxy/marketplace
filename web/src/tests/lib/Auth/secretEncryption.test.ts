import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'

describe('Auth-Secret-Verschlüsselung', function () {
    const previousKey = process.env.AUTH_ENCRYPTION_KEY

    beforeEach(function () {
        process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    })

    afterEach(function () {
        if (previousKey === undefined) {
            delete process.env.AUTH_ENCRYPTION_KEY
            return
        }

        process.env.AUTH_ENCRYPTION_KEY = previousKey
    })

    it('speichert das Secret nicht im Klartext und entschlüsselt es wieder', async function () {
        const secret = 'JBSWY3DPEHPK3PXP'
        const encrypted = await encryptAuthSecret(secret)

        expect(encrypted).not.toContain(secret)
        expect(await decryptAuthSecret(encrypted)).toBe(secret)
    })

    it('verwirft manipulierte Ciphertexte', async function () {
        const encrypted = await encryptAuthSecret('JBSWY3DPEHPK3PXP')
        const tampered = `${encrypted.slice(0, -2)}AA`

        await expect(
            Promise.resolve().then(function () {
                return decryptAuthSecret(tampered)
            }),
        ).rejects.toThrow()
    })
})
