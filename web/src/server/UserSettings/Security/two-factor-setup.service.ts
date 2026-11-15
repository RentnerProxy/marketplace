import { z } from 'zod'
import { TWO_FACTOR_SETUP_DURATION_MS } from '@/config/security.config.ts'
import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'

const pendingTwoFactorSetupSchema = z.strictObject({
    purpose: z.literal('two-factor-setup-v2'),
    secret: z
        .string()
        .length(32)
        .regex(/^[A-Z2-7]{32}$/),
    userId: z.string().min(1).max(100),
    sessionHash: z
        .string()
        .length(64)
        .regex(/^[a-f0-9]{64}$/),
    credentialVersion: z
        .string()
        .length(64)
        .regex(/^[a-f0-9]{64}$/),
    setupTokenHash: z
        .string()
        .length(64)
        .regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive(),
})

export async function createPendingTwoFactorSetup(
    secret: string,
    userId: string,
    sessionHash: string,
    credentialVersion: string,
) {
    const setupToken = crypto.randomUUID()
    const setup = pendingTwoFactorSetupSchema.parse({
        purpose: 'two-factor-setup-v2',
        secret,
        userId,
        sessionHash,
        credentialVersion,
        setupTokenHash: await createTokenHash(setupToken),
        expiresAt: Date.now() + TWO_FACTOR_SETUP_DURATION_MS,
    })

    return {
        setupToken,
        encryptedSetup: await encryptAuthSecret(JSON.stringify(setup)),
    }
}

export async function readPendingTwoFactorSetup(
    encryptedSetup: string,
    setupToken: string,
    userId: string,
    sessionHash: string,
) {
    try {
        const setup = pendingTwoFactorSetupSchema.parse(
            JSON.parse(await decryptAuthSecret(encryptedSetup)),
        )

        if (
            setup.userId !== userId ||
            setup.sessionHash !== sessionHash ||
            setup.expiresAt <= Date.now() ||
            setup.setupTokenHash !== (await createTokenHash(setupToken))
        ) {
            return null
        }

        return setup
    } catch {
        return null
    }
}
