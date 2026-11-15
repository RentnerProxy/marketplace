import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

const syntheticKeyBytes = Buffer.alloc(32, 53)
let encodedKey = syntheticKeyBytes.toString('base64')
const readRequiredEnvironment = vi.fn(function (_name: string): string {
    return encodedKey
})
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: readRequiredEnvironment,
}))

import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'

const validIv = Buffer.alloc(12, 11).toString('base64url')
const minimumCiphertext = Buffer.alloc(16).toString('base64url')
const formatEnvelope = `v1.${validIv}.${minimumCiphertext}`
const largeMailPayload = JSON.stringify({
    kind: 'security-change',
    to: 'synthetic@example.test',
    change: 'password_changed',
    changedAt: '2026-09-06T12:00:00.000Z',
    auditEventId: 'synthetic-audit-event',
    content: 'mail payload content '.repeat(2800),
})

beforeEach(function () {
    encodedKey = syntheticKeyBytes.toString('base64')
    readRequiredEnvironment.mockReset()
    readRequiredEnvironment.mockImplementation(() => encodedKey)
})
afterEach(function () {
    vi.restoreAllMocks()
})

function decodeEnvelope(value: string) {
    const [version, ivValue, ciphertextValue] = value.split('.')
    if (version !== 'v1' || !ivValue || !ciphertextValue)
        throw new Error('Expected a synthetic v1 fixture')
    return {
        ivValue,
        ciphertextValue,
        iv: Buffer.from(ivValue, 'base64url'),
        ciphertext: Buffer.from(ciphertextValue, 'base64url'),
    }
}

async function independentlyEncryptBytes(bytes: Uint8Array<ArrayBuffer>) {
    const key = await crypto.subtle.importKey(
        'raw',
        syntheticKeyBytes,
        'AES-GCM',
        false,
        ['encrypt'],
    )
    const iv = Buffer.alloc(12, 19)
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        bytes,
    )
    return `v1.${iv.toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`
}

describe('Auth secret canonical wire format and authenticated bytes', function () {
    it.each([
        { label: 'empty plaintext', value: '' },
        { label: 'ASCII plaintext', value: 'synthetic authentication value' },
        {
            label: 'Unicode and null characters',
            value: 'Grüße 日本語 😀 e\u0301\u0000',
        },
        { label: 'valid Unicode replacement character', value: '\uFFFD' },
        { label: 'large encrypted mail payload', value: largeMailPayload },
    ])('round-trips $label through real AES-GCM', async function ({ value }) {
        const encrypted = await encryptAuthSecret(value)
        const parts = encrypted.split('.')
        const decoded = decodeEnvelope(encrypted)
        expect(parts).toHaveLength(3)
        expect(parts[0]).toBe('v1')
        expect(decoded.ivValue).toHaveLength(16)
        expect(decoded.iv).toHaveLength(12)
        expect(decoded.ciphertext.byteLength).toBe(
            new TextEncoder().encode(value).byteLength + 16,
        )
        expect(decoded.iv.toString('base64url')).toBe(decoded.ivValue)
        expect(decoded.ciphertext.toString('base64url')).toBe(
            decoded.ciphertextValue,
        )
        expect(encrypted.length).toBeLessThan(100_000)
        expect(await decryptAuthSecret(encrypted)).toBe(value)
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(2)
        expect(readRequiredEnvironment).toHaveBeenCalledWith(
            'AUTH_ENCRYPTION_KEY',
        )
    })

    it('keeps the existing v1 writer interoperable with an independent AES-256-GCM reader', async function () {
        const plaintext = 'synthetic persisted v1 record'
        const encrypted = await encryptAuthSecret(plaintext)
        const decoded = decodeEnvelope(encrypted)
        const key = await crypto.subtle.importKey(
            'raw',
            syntheticKeyBytes,
            'AES-GCM',
            false,
            ['decrypt'],
        )
        const bytes = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decoded.iv, tagLength: 128 },
            key,
            decoded.ciphertext,
        )
        expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(
            plaintext,
        )
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
    })

    it('reads an independently generated existing v1 record including a tag-only empty plaintext', async function () {
        const empty = await independentlyEncryptBytes(new Uint8Array())
        const existing = await independentlyEncryptBytes(
            new TextEncoder().encode('synthetic legacy v1 value'),
        )
        expect(await decryptAuthSecret(empty)).toBe('')
        expect(await decryptAuthSecret(existing)).toBe(
            'synthetic legacy v1 value',
        )
        expect(decodeEnvelope(empty).ciphertext).toHaveLength(16)
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(2)
    })

    it('uses a fresh nonce for each encryption of the same synthetic value', async function () {
        const first = await encryptAuthSecret('synthetic repeated value')
        const second = await encryptAuthSecret('synthetic repeated value')
        expect(decodeEnvelope(first).ivValue).not.toBe(
            decodeEnvelope(second).ivValue,
        )
        expect(first).not.toBe(second)
        expect(await decryptAuthSecret(first)).toBe('synthetic repeated value')
        expect(await decryptAuthSecret(second)).toBe('synthetic repeated value')
    })

    it('rejects a ciphertext encrypted with another synthetic key', async function () {
        const encrypted = await encryptAuthSecret('synthetic key mismatch')
        readRequiredEnvironment.mockClear()
        encodedKey = Buffer.alloc(32, 71).toString('base64')
        await expect(decryptAuthSecret(encrypted)).rejects.toThrow()
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
    })

    it.each(['iv', 'ciphertext', 'tag'] as const)(
        'authenticates the %s bytes',
        async function (part) {
            const encrypted = await encryptAuthSecret(
                'synthetic ciphertext with authenticated content',
            )
            const decoded = decodeEnvelope(encrypted)
            const target = part === 'iv' ? decoded.iv : decoded.ciphertext
            const offset = part === 'tag' ? target.byteLength - 1 : 0
            const original = target[offset]
            if (original === undefined)
                throw new Error('Expected a nonempty synthetic crypto fixture')
            target[offset] = original ^ 1
            const altered = `v1.${decoded.iv.toString('base64url')}.${decoded.ciphertext.toString('base64url')}`
            readRequiredEnvironment.mockClear()
            await expect(decryptAuthSecret(altered)).rejects.toThrow()
            expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
        },
    )

    it('rejects truncated authenticated content even if it still has at least sixteen bytes', async function () {
        const encrypted = await encryptAuthSecret(
            'synthetic authenticated content long enough for truncation',
        )
        const decoded = decodeEnvelope(encrypted)
        const truncated = decoded.ciphertext.subarray(0, -1)
        expect(truncated.byteLength).toBeGreaterThanOrEqual(16)
        readRequiredEnvironment.mockClear()
        await expect(
            decryptAuthSecret(
                `v1.${decoded.ivValue}.${truncated.toString('base64url')}`,
            ),
        ).rejects.toThrow()
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
    })

    it.each([
        new Uint8Array([0xff]),
        new Uint8Array([0xc3, 0x28]),
        new Uint8Array([0xe2, 0x82]),
        new Uint8Array([0xc0, 0xaf]),
        new Uint8Array([0xed, 0xa0, 0x80]),
    ])(
        'rejects authenticated but invalid UTF-8 byte sequence %#',
        async function (bytes) {
            const encrypted = await independentlyEncryptBytes(bytes)
            await expect(decryptAuthSecret(encrypted)).rejects.toThrow()
            expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
        },
    )
})

describe('Malformed encrypted secret rejection before key access', function () {
    const invalidEnvelopes = [
        '',
        'synthetic plaintext TOTP seed',
        'v1',
        'v1.',
        `v1.${validIv}`,
        `v1.${validIv}.`,
        `v1..${minimumCiphertext}`,
        `v0.${validIv}.${minimumCiphertext}`,
        `v2.${validIv}.${minimumCiphertext}`,
        `V1.${validIv}.${minimumCiphertext}`,
        ` ${formatEnvelope}`,
        `${formatEnvelope} `,
        `${formatEnvelope}.extra`,
        `.${formatEnvelope}`,
        `${formatEnvelope}.`,
        `v1.${validIv}=.${minimumCiphertext}`,
        `v1.${validIv}.${minimumCiphertext}=`,
        `v1.+${validIv.slice(1)}.${minimumCiphertext}`,
        `v1./${validIv.slice(1)}.${minimumCiphertext}`,
        `v1.${validIv}.+${minimumCiphertext.slice(1)}`,
        `v1.${validIv}./${minimumCiphertext.slice(1)}`,
        `v1. ${validIv}.${minimumCiphertext}`,
        `v1.${validIv}.\t${minimumCiphertext}`,
        `v1.${validIv}\r.${minimumCiphertext}`,
        `v1.${validIv}.${minimumCiphertext}\n`,
        `v1.${validIv}%3D.${minimumCiphertext}`,
        `v1.${validIv}.${minimumCiphertext}%3D`,
        `v1.${Buffer.alloc(11).toString('base64url')}.${minimumCiphertext}`,
        `v1.${Buffer.alloc(13).toString('base64url')}.${minimumCiphertext}`,
        `v1.${validIv}.${Buffer.alloc(15).toString('base64url')}`,
        `v1.${validIv}.A`,
        `v1.${validIv}.${minimumCiphertext}AAA`,
    ]

    it.each(invalidEnvelopes)(
        'rejects malformed envelope %# without looking up a key',
        async function (value) {
            readRequiredEnvironment.mockImplementation(function () {
                throw new Error('A malformed envelope must never request a key')
            })
            await expect(decryptAuthSecret(value)).rejects.toThrow()
            expect(readRequiredEnvironment).not.toHaveBeenCalled()
        },
    )

    it.each([16, 17])(
        'rejects noncanonical trailing bits for a %i-byte decoded ciphertext',
        async function (length) {
            const canonical = Buffer.alloc(length).toString('base64url')
            const noncanonical = canonical.slice(0, -1) + 'B'
            expect(Buffer.from(noncanonical, 'base64url')).toEqual(
                Buffer.from(canonical, 'base64url'),
            )
            expect(
                Buffer.from(noncanonical, 'base64url').toString('base64url'),
            ).not.toBe(noncanonical)
            await expect(
                decryptAuthSecret(`v1.${validIv}.${noncanonical}`),
            ).rejects.toThrow()
            expect(readRequiredEnvironment).not.toHaveBeenCalled()
        },
    )

    it('does request the key for a canonical envelope and preserves a missing-key failure', async function () {
        readRequiredEnvironment.mockImplementation(function () {
            throw new Error('Synthetic required key unavailable')
        })
        await expect(decryptAuthSecret(formatEnvelope)).rejects.toThrow(
            'Synthetic required key unavailable',
        )
        expect(readRequiredEnvironment).toHaveBeenCalledTimes(1)
    })
})
