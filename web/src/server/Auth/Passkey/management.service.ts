import { notifyCommittedSecurityChangeService } from '@/server/Auth/security-change-notification.service.ts'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passkeyCredentials, sessions } from '@/db/schema.ts'
import { publishCommittedFactorSessionRevocationService } from '@/server/Auth/factor-session-revocation.service.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import type { DeleteCurrentUserPasskeyInput } from '@/features/UserSettings/Types/user-settings-server-input.types.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'
import { validateReauthenticationProofService } from '@/server/Auth/reauthentication-proof.service.ts'
import { hasRemainingSignInMethodService } from '@/server/Auth/remaining-sign-in.service.ts'

export async function getCurrentUserPasskeysService() {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { passkeys: [] }
    }

    const passkeys = await db
        .select({
            id: passkeyCredentials.id,
            name: passkeyCredentials.name,
            deviceType: passkeyCredentials.deviceType,
            backedUp: passkeyCredentials.backedUp,
            createdAt: passkeyCredentials.createdAt,
            lastUsedAt: passkeyCredentials.lastUsedAt,
        })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, currentUser.id))
        .orderBy(desc(passkeyCredentials.createdAt))

    return {
        passkeys: passkeys.map(function (passkey) {
            const { createdAt, lastUsedAt, ...passkeyData } = passkey

            return Object.assign(passkeyData, {
                createdAt: createdAt.toISOString(),
                lastUsedAt: lastUsedAt?.toISOString() ?? null,
            })
        }),
    }
}

export async function deleteCurrentUserPasskeyService(
    data: DeleteCurrentUserPasskeyInput,
) {
    const reauthentication = await reauthenticateCurrentUserService(
        data.reauthentication,
    )

    if (!reauthentication.success) {
        return reauthentication
    }

    const auditContext = prepareAuditContextService(
        reauthentication.currentUser.id,
    )
    const result = await db.transaction(async function (transaction) {
        const state = await validateReauthenticationProofService(
            transaction,
            reauthentication.proof,
        )
        if (
            !state ||
            state.currentUser.id !== reauthentication.currentUser.id
        ) {
            return {
                success: false as const,
                error: 'Bestätigung fehlgeschlagen. Prüfe deine Eingabe und versuche es erneut.',
            }
        }
        if (
            data.reauthentication.method !== 'password' &&
            !(await hasRemainingSignInMethodService(transaction, {
                userId: state.currentUser.id,
                excludedPasskeyId: data.passkeyId,
            }))
        ) {
            return {
                success: false as const,
                error: 'Der letzte Anmeldeweg kann nicht entfernt werden. Ein weiterer Anmeldeanbieter oder Passkey muss verfügbar bleiben.',
            }
        }
        const deletedPasskeys = await transaction
            .delete(passkeyCredentials)
            .where(
                and(
                    eq(passkeyCredentials.id, data.passkeyId),
                    eq(passkeyCredentials.userId, state.currentUser.id),
                ),
            )
            .returning({ id: passkeyCredentials.id })
        if (deletedPasskeys.length === 0) {
            return {
                success: false as const,
                error: 'Passkey wurde nicht gefunden.',
            }
        }
        await transaction
            .delete(sessions)
            .where(eq(sessions.userId, state.currentUser.id))
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.passkey_deleted',
                message: 'Passkey wurde entfernt.',
                newValues: { sessionsRevoked: 'all' },
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
        change: 'passkey_removed',
        auditReceipt: result.auditReceipt,
    })
    await publishCommittedFactorSessionRevocationService({
        userId: result.revocationUserId,
        auditReceipt: result.auditReceipt,
    })
    await publishCommittedAuditLogService(result.auditReceipt)

    return { success: true as const }
}
