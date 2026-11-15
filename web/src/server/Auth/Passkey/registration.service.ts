import { notifyCommittedSecurityChangeService } from '@/server/Auth/security-change-notification.service.ts'
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { and, eq, gt } from 'drizzle-orm'
import type { RegistrationResponseJSON } from '@simplewebauthn/browser'
import { registrationResponseSchema } from './response.validation.ts'
import { db } from '@/db'
import { passkeyChallenges, passkeyCredentials, sessions } from '@/db/schema.ts'
import { publishCommittedFactorSessionRevocationService } from '@/server/Auth/factor-session-revocation.service.ts'
import { createWebAuthnUserId } from '@/lib/Auth/passkeys.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import {
    getLockedReauthenticationStateService,
    validateReauthenticationProofService,
} from '@/server/Auth/reauthentication-proof.service.ts'
import type {
    BeginCurrentUserPasskeyRegistrationInput,
    FinishCurrentUserPasskeyRegistrationInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'
import {
    deleteExpiredPasskeyChallenges,
    getChallengeExpiresAt,
    REGISTRATION_CHALLENGE_TYPE,
} from './challenge.service.ts'
import { toStoredTransports } from './credential.ts'
import { getPasskeyConfig } from './config.service.ts'
import { toSerializablePasskeyOptions } from './options.ts'

async function hashRegistrationToken(
    token: string,
    sessionHash: string,
    credentialVersion: string,
) {
    return createTokenHash(
        JSON.stringify([
            'passkey-registration-v3',
            sessionHash,
            credentialVersion,
            token,
        ]),
    )
}

export async function beginCurrentUserPasskeyRegistrationService(
    data: BeginCurrentUserPasskeyRegistrationInput,
) {
    const reauthentication = await reauthenticateCurrentUserService(
        data.reauthentication,
    )
    if (!reauthentication.success) return reauthentication
    const passkeyConfig = getPasskeyConfig()
    await deleteExpiredPasskeyChallenges()

    return db.transaction(async function (transaction) {
        const state = await validateReauthenticationProofService(
            transaction,
            reauthentication.proof,
        )
        if (
            !state ||
            state.currentUser.id !== reauthentication.currentUser.id
        ) {
            if (state)
                recordRejectedAuthenticationService(
                    'reauthentication',
                    'stale_proof',
                )
            return {
                success: false as const,
                error: 'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.',
            }
        }
        const { currentUser } = state
        const existingPasskeys = await transaction
            .select()
            .from(passkeyCredentials)
            .where(eq(passkeyCredentials.userId, currentUser.id))
        const webauthnUserId =
            existingPasskeys.at(0)?.webauthnUserId ?? createWebAuthnUserId()
        const options = await generateRegistrationOptions({
            rpName: passkeyConfig.rpName,
            rpID: passkeyConfig.rpID,
            userName: currentUser.email,
            userID: Buffer.from(webauthnUserId, 'base64url'),
            userDisplayName: currentUser.username,
            attestationType: 'none',
            excludeCredentials: existingPasskeys.map((passkey) => ({
                id: passkey.credentialId,
                transports: toStoredTransports(passkey.transports),
            })),
            authenticatorSelection: {
                residentKey: 'required',
                userVerification: 'required',
            },
        })
        const registrationToken = crypto.randomUUID()
        const registrationTokenHash = await hashRegistrationToken(
            registrationToken,
            state.sessionHash,
            state.credentialVersion,
        )
        const challengeRows = await transaction
            .insert(passkeyChallenges)
            .values({
                userId: currentUser.id,
                identifier: registrationTokenHash,
                webauthnUserId,
                challenge: options.challenge,
                type: REGISTRATION_CHALLENGE_TYPE,
                expiresAt: getChallengeExpiresAt(),
            })
            .returning({ id: passkeyChallenges.id })
        return {
            success: true as const,
            challengeId: challengeRows[0].id,
            registrationToken,
            options: toSerializablePasskeyOptions(options),
        }
    })
}

export async function finishCurrentUserPasskeyRegistrationService(
    data: FinishCurrentUserPasskeyRegistrationInput,
) {
    const currentSession = await getActiveCurrentSessionUser()
    if (!currentSession) {
        recordRejectedAuthenticationService(
            'reauthentication',
            'invalid_session',
        )
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }
    const passkeyConfig = getPasskeyConfig()
    const auditContext = prepareAuditContextService(currentSession.id)
    const result = await db.transaction(async function (transaction) {
        const state = await getLockedReauthenticationStateService(transaction, {
            userId: currentSession.id,
            sessionHash: currentSession.sessionHash,
        })
        if (!state) {
            recordRejectedAuthenticationService(
                'reauthentication',
                'stale_proof',
            )
            return {
                success: false as const,
                error: 'Passkey-Registrierung ist abgelaufen. Bitte starte erneut.',
            }
        }
        const { currentUser } = state
        const registrationTokenHash = await hashRegistrationToken(
            data.registrationToken,
            state.sessionHash,
            state.credentialVersion,
        )

        const challengeRows = await transaction
            .delete(passkeyChallenges)
            .where(
                and(
                    eq(passkeyChallenges.id, data.challengeId),
                    eq(passkeyChallenges.type, REGISTRATION_CHALLENGE_TYPE),
                    eq(passkeyChallenges.identifier, registrationTokenHash),
                    eq(passkeyChallenges.userId, currentUser.id),
                    gt(passkeyChallenges.expiresAt, new Date()),
                ),
            )
            .returning()
        const challenge = challengeRows.at(0)
        if (!challenge || !challenge.webauthnUserId) {
            recordRejectedAuthenticationService(
                'reauthentication',
                'stale_proof',
            )
            return {
                success: false as const,
                error: 'Passkey-Registrierung ist abgelaufen. Bitte starte erneut.',
            }
        }
        let registrationResponse: RegistrationResponseJSON
        let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
        try {
            registrationResponse = registrationResponseSchema.parse(
                data.response,
            )
            verification = await verifyRegistrationResponse({
                response: registrationResponse,
                expectedChallenge: challenge.challenge,
                expectedOrigin: passkeyConfig.origin,
                expectedRPID: passkeyConfig.rpID,
                requireUserVerification: true,
            })
        } catch {
            recordRejectedAuthenticationService(
                'reauthentication',
                'invalid_passkey',
            )
            return {
                success: false as const,
                error: 'Passkey konnte nicht bestätigt werden.',
            }
        }
        if (!verification.verified) {
            recordRejectedAuthenticationService(
                'reauthentication',
                'invalid_passkey',
            )
            return {
                success: false as const,
                error: 'Passkey konnte nicht bestätigt werden.',
            }
        }
        const { credential, credentialBackedUp, credentialDeviceType } =
            verification.registrationInfo
        const transports = toStoredTransports(
            registrationResponse.response.transports ?? [],
        )
        const duplicateRows = await transaction
            .select({ id: passkeyCredentials.id })
            .from(passkeyCredentials)
            .where(eq(passkeyCredentials.credentialId, credential.id))
            .limit(1)
        if (duplicateRows.length > 0)
            return {
                success: false as const,
                error: 'Dieser Passkey ist bereits eingerichtet.',
            }
        const passkeyCount = await transaction
            .select({ id: passkeyCredentials.id })
            .from(passkeyCredentials)
            .where(eq(passkeyCredentials.userId, currentUser.id))
        await transaction.insert(passkeyCredentials).values({
            userId: currentUser.id,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString('base64url'),
            webauthnUserId: challenge.webauthnUserId,
            counter: credential.counter,
            transports,
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
            name: 'Passkey ' + String(passkeyCount.length + 1),
        })
        await transaction
            .delete(sessions)
            .where(eq(sessions.userId, currentUser.id))
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.passkey_added',
                message: 'Passkey wurde hinzugefügt.',
                newValues: {
                    deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp,
                    sessionsRevoked: 'all',
                },
            },
        )
        return {
            success: true as const,
            auditReceipt,
            notificationRecipient: state.currentUser.email,
            revocationUserId: state.currentUser.id,
        }
    })
    if (!result.success) return result
    await notifyCommittedSecurityChangeService({
        to: result.notificationRecipient,
        change: 'passkey_added',
        auditReceipt: result.auditReceipt,
    })
    await publishCommittedFactorSessionRevocationService({
        userId: result.revocationUserId,
        auditReceipt: result.auditReceipt,
    })
    await publishCommittedAuditLogService(result.auditReceipt)
    return { success: true as const }
}
