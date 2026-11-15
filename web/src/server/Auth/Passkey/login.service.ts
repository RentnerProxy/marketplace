import {
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { authenticationResponseSchema } from './response.validation.ts'
import { db } from '@/db'
import { passkeyChallenges, passkeyCredentials, users } from '@/db/schema.ts'
import { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import type {
    BeginPasskeyLoginInput,
    FinishPasskeyLoginInput,
} from '@/features/Auth/Login/Types/login-server-input.types.ts'
import {
    AUTHENTICATION_CHALLENGE_TYPE,
    consumeLatestValidChallenge,
    deleteExpiredPasskeyChallenges,
    getChallengeExpiresAt,
} from './challenge.service.ts'
import { toCredential } from './credential.ts'
import { getPasskeyConfig } from './config.service.ts'
import { toSerializablePasskeyOptions } from './options.ts'
import { recordRejectedAuthenticationService } from '../rejected-authentication.service.ts'
import type { RejectedAuthenticationReason } from '../Types/rejected-authentication.types.ts'

function passkeyLoginFailed(
    reason: RejectedAuthenticationReason = 'invalid_passkey',
) {
    recordRejectedAuthenticationService('passkey_login', reason)
    return {
        success: false as const,
        error: 'Passkey-Anmeldung konnte nicht bestätigt werden.',
    }
}

function matchesUserHandle(handle: unknown, expectedHandle: string) {
    return (
        typeof handle === 'string' &&
        /^[A-Za-z0-9_-]+$/.test(handle) &&
        Buffer.from(handle, 'base64url').toString('base64url') === handle &&
        handle === expectedHandle
    )
}

export async function beginPasskeyLoginService(data: BeginPasskeyLoginInput) {
    const passkeyConfig = getPasskeyConfig()

    await deleteExpiredPasskeyChallenges()

    const username = data.username?.trim() || undefined
    const options = await generateAuthenticationOptions({
        rpID: passkeyConfig.rpID,
        userVerification: 'required',
    })

    const challengeRows = await db
        .insert(passkeyChallenges)
        .values({
            identifier: username,
            challenge: options.challenge,
            type: AUTHENTICATION_CHALLENGE_TYPE,
            expiresAt: getChallengeExpiresAt(),
        })
        .returning({ id: passkeyChallenges.id })

    return {
        success: true as const,
        challengeId: challengeRows[0].id,
        options: toSerializablePasskeyOptions(options),
    }
}

export async function finishPasskeyLoginService(data: FinishPasskeyLoginInput) {
    const passkeyConfig = getPasskeyConfig()
    const challenge = await consumeLatestValidChallenge(
        data.challengeId,
        AUTHENTICATION_CHALLENGE_TYPE,
    )

    if (!challenge) {
        recordRejectedAuthenticationService(
            'passkey_login',
            'invalid_challenge',
        )
        return {
            success: false as const,
            error: 'Passkey-Anmeldung ist abgelaufen. Bitte starte erneut.',
        }
    }

    const parsedResponse = authenticationResponseSchema.safeParse(data.response)
    if (!parsedResponse.success) return passkeyLoginFailed()
    const response: AuthenticationResponseJSON = parsedResponse.data
    const passkeyRows = await db
        .select({
            passkey: passkeyCredentials,
            user: users,
        })
        .from(passkeyCredentials)
        .innerJoin(users, eq(users.id, passkeyCredentials.userId))
        .where(eq(passkeyCredentials.credentialId, response.id))
        .limit(1)
    const passkeyRow = passkeyRows.at(0)

    if (
        !passkeyRow ||
        passkeyRow.user.isDeleted ||
        !passkeyRow.user.isActive ||
        !matchesUserHandle(
            response.response.userHandle,
            passkeyRow.passkey.webauthnUserId,
        )
    ) {
        return passkeyLoginFailed()
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>

    try {
        verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: passkeyConfig.origin,
            expectedRPID: passkeyConfig.rpID,
            credential: toCredential(passkeyRow.passkey),
            requireUserVerification: true,
        })
    } catch {
        return passkeyLoginFailed()
    }

    if (
        !verification.verified ||
        (challenge.identifier &&
            challenge.identifier !== passkeyRow.user.username)
    ) {
        return passkeyLoginFailed()
    }

    const result = await createAuthenticatedSessionForUser({
        user: passkeyRow.user,
        proof: {
            kind: 'passkey',
            passkeyId: passkeyRow.passkey.id,
            counter: passkeyRow.passkey.counter,
            newCounter: verification.authenticationInfo.newCounter,
        },
        auditAction: 'auth.passkey_login',
        auditMessage: `Benutzer ${passkeyRow.user.username} hat sich per Passkey angemeldet.`,
    })

    return result.success ? result : passkeyLoginFailed('stale_credentials')
}
