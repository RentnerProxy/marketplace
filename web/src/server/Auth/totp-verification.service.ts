import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { twoFactorAuth } from '@/db/schema.ts'
import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'
import { getTotpCodeStep } from '@/lib/Auth/totp.ts'
import type { TotpFactor } from './Types/totp.types.ts'

const activeTotpStateSchema = z.strictObject({
    purpose: z.literal('totp-state-v1'),
    factorId: z.string().min(1).max(100),
    userId: z.string().min(1).max(100),
    secret: z.string().regex(/^[A-Z2-7]{32}$/),
    lastConsumedStep: z.number().int().nonnegative(),
})

export async function createActiveTotpSecret(
    secret: string,
    lastConsumedStep: number,
    identity: Pick<TotpFactor, 'id' | 'userId'>,
) {
    const state = activeTotpStateSchema.parse({
        purpose: 'totp-state-v1',
        factorId: identity.id,
        userId: identity.userId,
        secret,
        lastConsumedStep,
    })

    return encryptAuthSecret(JSON.stringify(state))
}

async function readActiveTotpState(factor: TotpFactor) {
    const plaintext = await decryptAuthSecret(factor.secret)

    if (/^[A-Z2-7]{32}$/.test(plaintext)) {
        return { secret: plaintext, lastConsumedStep: -1 }
    }

    const state = activeTotpStateSchema.parse(JSON.parse(plaintext))
    return state.factorId === factor.id && state.userId === factor.userId
        ? state
        : null
}

export async function consumeTotpCodeService(
    factor: TotpFactor,
    token: string,
) {
    if (!factor.verified) {
        return false
    }

    let state: Awaited<ReturnType<typeof readActiveTotpState>>
    try {
        state = await readActiveTotpState(factor)
    } catch {
        return false
    }

    if (!state) {
        return false
    }

    const step = getTotpCodeStep(state.secret, token)
    if (step === null || step <= state.lastConsumedStep) {
        return false
    }

    const encryptedSecret = await createActiveTotpSecret(
        state.secret,
        step,
        factor,
    )
    const consumed = await db
        .update(twoFactorAuth)
        .set({ secret: encryptedSecret })
        .where(
            and(
                eq(twoFactorAuth.id, factor.id),
                eq(twoFactorAuth.userId, factor.userId),
                eq(twoFactorAuth.verified, true),
                eq(twoFactorAuth.secret, factor.secret),
            ),
        )
        .returning({ id: twoFactorAuth.id })

    return consumed.length === 1
}
