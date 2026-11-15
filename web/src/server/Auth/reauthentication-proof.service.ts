import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { REAUTHENTICATION_PROOF_DURATION_MS } from '@/config/security.config.ts'
import { sessions, twoFactorAuth, users } from '@/db/schema.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type {
    LockedReauthenticationState,
    ReauthenticationCredentialUser,
    ReauthenticationProof,
    ReauthenticationSessionIdentity,
    ReauthenticationTransaction,
} from './Types/reauthentication.types.ts'

import { recordRejectedAuthenticationService } from './rejected-authentication.service.ts'

const identitySchema = z.string().min(1).max(100)
const digestSchema = z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/)
const credentialUserSchema = z.object({
    id: identitySchema,
    passwordHash: z.string().min(1).max(1024),
    isTwoFactorEnabled: z.boolean(),
})
const sessionIdentitySchema = z.object({
    userId: identitySchema,
    sessionHash: digestSchema,
})
const proofSchema = z.strictObject({
    userId: identitySchema,
    sessionHash: digestSchema,
    credentialVersion: digestSchema,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})

async function credentialVersion(
    user: ReauthenticationCredentialUser,
    factorId: string | null,
) {
    return createTokenHash(
        JSON.stringify([
            'reauthentication-credentials-v1',
            user.id,
            user.passwordHash,
            user.isTwoFactorEnabled,
            factorId,
        ]),
    )
}

export async function createReauthenticationProofService(
    verifiedUser: ReauthenticationCredentialUser,
    factorId: string | null,
    sessionHash: string,
): Promise<ReauthenticationProof> {
    const parsedUser = credentialUserSchema.safeParse(verifiedUser)
    const parsedSession = digestSchema.safeParse(sessionHash)
    const parsedFactor = identitySchema.nullable().safeParse(factorId)
    if (
        !parsedUser.success ||
        !parsedSession.success ||
        !parsedFactor.success ||
        parsedUser.data.isTwoFactorEnabled !== (parsedFactor.data !== null)
    ) {
        throw new Error('Invalid reauthentication proof input')
    }
    return {
        userId: parsedUser.data.id,
        sessionHash: parsedSession.data,
        credentialVersion: await credentialVersion(
            parsedUser.data,
            parsedFactor.data,
        ),
        expiresAt: Date.now() + REAUTHENTICATION_PROOF_DURATION_MS,
    }
}

export async function getLockedReauthenticationStateService(
    transaction: ReauthenticationTransaction,
    identity: ReauthenticationSessionIdentity,
): Promise<LockedReauthenticationState | null> {
    const parsedIdentity = sessionIdentitySchema.safeParse(identity)
    if (!parsedIdentity.success) return null
    const { userId, sessionHash } = parsedIdentity.data

    const userRows = await transaction
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            passwordHash: users.passwordHash,
            isTwoFactorEnabled: users.isTwoFactorEnabled,
        })
        .from(users)
        .where(
            and(
                eq(users.id, userId),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
            ),
        )
        .limit(1)
        .for('update')
    const currentUser = userRows.at(0)
    if (!currentUser) return null

    const sessionRows = await transaction
        .select({
            id: sessions.id,
            userId: sessions.userId,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(eq(sessions.id, sessionHash), eq(sessions.userId, userId)))
        .limit(1)
        .for('update')
    const session = sessionRows.at(0)
    if (!session || session.expiresAt.getTime() <= Date.now()) return null

    const factorRows = await transaction
        .select({
            id: twoFactorAuth.id,
            userId: twoFactorAuth.userId,
            verified: twoFactorAuth.verified,
        })
        .from(twoFactorAuth)
        .where(eq(twoFactorAuth.userId, userId))
        .limit(1)
        .for('update')
    const factor = factorRows.at(0)
    if (
        (currentUser.isTwoFactorEnabled && !factor?.verified) ||
        (!currentUser.isTwoFactorEnabled && factor?.verified)
    ) {
        return null
    }
    const factorId = factor?.verified ? factor.id : null
    const version = await credentialVersion(currentUser, factorId)

    if (session.expiresAt.getTime() <= Date.now()) return null
    return {
        currentUser: {
            id: currentUser.id,
            username: currentUser.username,
            email: currentUser.email,
            isTwoFactorEnabled: currentUser.isTwoFactorEnabled,
        },
        sessionHash,
        credentialVersion: version,
        factorId,
    }
}

export async function validateReauthenticationProofService(
    transaction: ReauthenticationTransaction,
    proof: ReauthenticationProof,
): Promise<LockedReauthenticationState | null> {
    const parsed = proofSchema.safeParse(proof)
    if (
        !parsed.success ||
        parsed.data.expiresAt <= Date.now() ||
        parsed.data.expiresAt > Date.now() + REAUTHENTICATION_PROOF_DURATION_MS
    ) {
        recordRejectedAuthenticationService('reauthentication', 'stale_proof')
        return null
    }
    const current = await getLockedReauthenticationStateService(
        transaction,
        parsed.data,
    )
    if (
        !current ||
        current.credentialVersion !== parsed.data.credentialVersion ||
        parsed.data.expiresAt <= Date.now()
    ) {
        recordRejectedAuthenticationService('reauthentication', 'stale_proof')
        return null
    }
    return current
}
