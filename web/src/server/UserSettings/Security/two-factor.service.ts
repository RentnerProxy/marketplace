import { notifyCommittedSecurityChangeService } from '@/server/Auth/security-change-notification.service.ts'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, trustedDevices, twoFactorAuth, users } from '@/db/schema.ts'
import { publishCommittedFactorSessionRevocationService } from '@/server/Auth/factor-session-revocation.service.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { createActiveTotpSecret } from '@/server/Auth/totp-verification.service.ts'
import {
    createTotp,
    createTotpSecret,
    getTotpCodeStep,
} from '@/lib/Auth/totp.ts'
import {
    getActiveCurrentSessionUser,
    getCurrentUserSettingsSession,
} from '@/server/Auth/currentSession.ts'
import {
    createPendingTwoFactorSetup,
    readPendingTwoFactorSetup,
} from './two-factor-setup.service.ts'
import type {
    BeginCurrentUserTwoFactorSetupInput,
    ConfirmCurrentUserTwoFactorSetupInput,
    DisableCurrentUserTwoFactorInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import {
    getLockedReauthenticationStateService,
    validateReauthenticationProofService,
} from '@/server/Auth/reauthentication-proof.service.ts'

export async function getCurrentTwoFactorStatusService() {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { isEnabled: false, isSetupPending: false }
    }

    const rows = await db
        .select()
        .from(twoFactorAuth)
        .where(eq(twoFactorAuth.userId, currentUser.id))
        .limit(1)

    const twoFactor = rows.at(0)
    return {
        isEnabled: twoFactor?.verified ?? false,
        isSetupPending: twoFactor !== undefined && !twoFactor.verified,
    }
}

export async function beginCurrentUserTwoFactorSetupService(
    data: BeginCurrentUserTwoFactorSetupInput,
) {
    const reauthentication = await reauthenticateCurrentUserService(
        data.reauthentication,
    )

    if (!reauthentication.success) {
        return reauthentication
    }

    const currentUser = await getActiveCurrentSessionUser()

    if (
        !currentUser ||
        currentUser.id !== reauthentication.currentUser.id ||
        currentUser.sessionHash !== reauthentication.proof.sessionHash
    ) {
        recordRejectedAuthenticationService('reauthentication', 'stale_proof')
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const secret = createTotpSecret()
    const label = currentUser.email
    const totp = await createTotp(secret, label)
    const auditContext = prepareAuditContextService(currentUser.id)
    const setupStarted = await db.transaction(async function (transaction) {
        const lockedState = await validateReauthenticationProofService(
            transaction,
            reauthentication.proof,
        )

        if (!lockedState) {
            return false
        }

        const existingRows = await transaction
            .select({
                id: twoFactorAuth.id,
                verified: twoFactorAuth.verified,
            })
            .from(twoFactorAuth)
            .where(eq(twoFactorAuth.userId, currentUser.id))
            .limit(1)
        const existing = existingRows.at(0)

        if (existing?.verified) {
            return false
        }

        if (existing) {
            const deletedPendingSetups = await transaction
                .delete(twoFactorAuth)
                .where(
                    and(
                        eq(twoFactorAuth.id, existing.id),
                        eq(twoFactorAuth.userId, currentUser.id),
                        eq(twoFactorAuth.verified, false),
                    ),
                )
                .returning({ id: twoFactorAuth.id })

            if (deletedPendingSetups.length === 0) {
                return false
            }
        }

        const pendingSetup = await createPendingTwoFactorSetup(
            secret,
            currentUser.id,
            currentUser.sessionHash,
            lockedState.credentialVersion,
        )
        const insertedSetups = await transaction
            .insert(twoFactorAuth)
            .values({
                userId: currentUser.id,
                secret: pendingSetup.encryptedSetup,
                verified: false,
            })
            .onConflictDoNothing({ target: twoFactorAuth.userId })
            .returning({ id: twoFactorAuth.id })

        if (insertedSetups.length === 0) {
            if (existing) {
                throw new Error('Das 2FA-Setup konnte nicht angelegt werden.')
            }
            return false
        }
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.two_factor_setup_started',
                message: '2FA-Setup wurde gestartet.',
                newValues: { verified: false },
            },
        )
        return { ...pendingSetup, auditReceipt }
    })

    if (!setupStarted) {
        return {
            success: false as const,
            error: '2FA ist bereits aktiviert oder wurde zwischenzeitlich geändert. Deaktiviere 2FA zuerst, bevor du sie erneut einrichtest.',
        }
    }

    await publishCommittedAuditLogService(setupStarted.auditReceipt)

    return {
        success: true as const,
        secret,
        otpAuthUrl: totp.toString(),
        setupToken: setupStarted.setupToken,
    }
}

export async function confirmCurrentUserTwoFactorSetupService(
    data: ConfirmCurrentUserTwoFactorSetupInput,
) {
    const currentUser = await getActiveCurrentSessionUser()

    if (!currentUser) {
        recordRejectedAuthenticationService(
            'reauthentication',
            'invalid_session',
        )
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const rows = await db
        .select()
        .from(twoFactorAuth)
        .where(eq(twoFactorAuth.userId, currentUser.id))
        .limit(1)

    const twoFactor = rows.at(0)

    if (!twoFactor) {
        return {
            success: false as const,
            restartSetup: true as const,
            error: 'Starte zuerst das 2FA-Setup.',
        }
    }

    if (twoFactor.verified) {
        return {
            success: false as const,
            restartSetup: true as const,
            error: '2FA ist bereits aktiviert.',
        }
    }

    const pendingSetup = await readPendingTwoFactorSetup(
        twoFactor.secret,
        data.setupToken,
        currentUser.id,
        currentUser.sessionHash,
    )

    if (!pendingSetup) {
        recordRejectedAuthenticationService('reauthentication', 'stale_proof')
        return {
            success: false as const,
            restartSetup: true as const,
            error: 'Das 2FA-Setup ist abgelaufen oder ungültig. Starte die Einrichtung erneut.',
        }
    }

    const confirmedStep = getTotpCodeStep(pendingSetup.secret, data.token)
    if (confirmedStep === null) {
        recordRejectedAuthenticationService(
            'reauthentication',
            'invalid_two_factor',
        )
        return { success: false as const, error: 'Der 2FA-Code ist ungültig.' }
    }

    const encryptedSecret = await createActiveTotpSecret(
        pendingSetup.secret,
        confirmedStep,
        { id: twoFactor.id, userId: currentUser.id },
    )
    const auditContext = prepareAuditContextService(currentUser.id)
    const setupConfirmed = await db.transaction(async function (transaction) {
        const lockedState = await getLockedReauthenticationStateService(
            transaction,
            { userId: currentUser.id, sessionHash: currentUser.sessionHash },
        )

        if (
            !lockedState ||
            lockedState.currentUser.isTwoFactorEnabled ||
            lockedState.credentialVersion !== pendingSetup.credentialVersion ||
            pendingSetup.expiresAt <= Date.now()
        ) {
            return false
        }

        const confirmedFactors = await transaction
            .update(twoFactorAuth)
            .set({ verified: true, secret: encryptedSecret })
            .where(
                and(
                    eq(twoFactorAuth.id, twoFactor.id),
                    eq(twoFactorAuth.userId, currentUser.id),
                    eq(twoFactorAuth.secret, twoFactor.secret),
                    eq(twoFactorAuth.verified, false),
                ),
            )
            .returning({ id: twoFactorAuth.id })

        if (confirmedFactors.length === 0) {
            return false
        }

        const updatedUsers = await transaction
            .update(users)
            .set({ isTwoFactorEnabled: true })
            .where(eq(users.id, currentUser.id))
            .returning({ id: users.id })

        if (updatedUsers.length === 0) {
            throw new Error(
                'Der Benutzer für das 2FA-Setup wurde nicht gefunden.',
            )
        }

        await transaction
            .delete(sessions)
            .where(eq(sessions.userId, lockedState.currentUser.id))

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.two_factor_enabled',
                message: '2FA wurde aktiviert.',
                oldValues: { isTwoFactorEnabled: false },
                newValues: {
                    isTwoFactorEnabled: true,
                    sessionsRevoked: 'all',
                },
            },
        )
        return {
            auditReceipt,
            notificationRecipient: lockedState.currentUser.email,
            revocationUserId: lockedState.currentUser.id,
        }
    })

    if (!setupConfirmed) {
        recordRejectedAuthenticationService('reauthentication', 'stale_proof')
        return {
            success: false as const,
            restartSetup: true as const,
            error: 'Das 2FA-Setup wurde zwischenzeitlich geändert. Starte die Einrichtung erneut.',
        }
    }

    await notifyCommittedSecurityChangeService({
        to: setupConfirmed.notificationRecipient,
        change: 'totp_enabled',
        auditReceipt: setupConfirmed.auditReceipt,
    })
    await publishCommittedFactorSessionRevocationService({
        userId: setupConfirmed.revocationUserId,
        auditReceipt: setupConfirmed.auditReceipt,
    })
    await publishCommittedAuditLogService(setupConfirmed.auditReceipt)

    return { success: true as const }
}

export async function disableCurrentUserTwoFactorService(
    data: DisableCurrentUserTwoFactorInput,
) {
    const reauthentication = await reauthenticateCurrentUserService(
        data.reauthentication,
    )

    if (!reauthentication.success) {
        return reauthentication
    }

    const { currentUser } = reauthentication

    const auditContext = prepareAuditContextService(currentUser.id)
    const disabled = await db.transaction(async function (transaction) {
        const lockedState = await validateReauthenticationProofService(
            transaction,
            reauthentication.proof,
        )

        if (!lockedState) {
            return false
        }

        if (
            !lockedState.currentUser.isTwoFactorEnabled ||
            !lockedState.factorId
        ) {
            return false
        }
        const deletedFactors = await transaction
            .delete(twoFactorAuth)
            .where(
                and(
                    eq(twoFactorAuth.id, lockedState.factorId),
                    eq(twoFactorAuth.userId, currentUser.id),
                    eq(twoFactorAuth.verified, true),
                ),
            )
            .returning({ id: twoFactorAuth.id })
        if (deletedFactors.length !== 1) {
            return false
        }
        await transaction
            .delete(trustedDevices)
            .where(eq(trustedDevices.userId, currentUser.id))

        const updatedUsers = await transaction
            .update(users)
            .set({ isTwoFactorEnabled: false })
            .where(eq(users.id, currentUser.id))
            .returning({ id: users.id })

        if (updatedUsers.length === 0) {
            throw new Error(
                'Der Benutzer für die 2FA-Deaktivierung wurde nicht gefunden.',
            )
        }

        await transaction
            .delete(sessions)
            .where(eq(sessions.userId, lockedState.currentUser.id))

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.two_factor_disabled',
                message: '2FA wurde deaktiviert.',
                oldValues: { isTwoFactorEnabled: true },
                newValues: {
                    isTwoFactorEnabled: false,
                    sessionsRevoked: 'all',
                },
            },
        )
        return {
            auditReceipt,
            notificationRecipient: lockedState.currentUser.email,
            revocationUserId: lockedState.currentUser.id,
        }
    })

    if (!disabled) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    await notifyCommittedSecurityChangeService({
        to: disabled.notificationRecipient,
        change: 'totp_disabled',
        auditReceipt: disabled.auditReceipt,
    })
    await publishCommittedFactorSessionRevocationService({
        userId: disabled.revocationUserId,
        auditReceipt: disabled.auditReceipt,
    })
    await publishCommittedAuditLogService(disabled.auditReceipt)

    return { success: true as const }
}
