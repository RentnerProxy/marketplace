import { deleteCookie, setCookie } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { db } from '@/db'
import { getClientRequestMeta } from '@/lib/Request/clientRequestMeta.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import {
    passkeyCredentials,
    permissions,
    sessions,
    trustedDevices,
    twoFactorAuth,
    accountPermissions,
    users,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getDefaultRouteForPermissions,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'
import {
    SESSION_COOKIE_NAME,
    trustedDeviceConfig,
    TRUSTED_DEVICE_COOKIE_NAME,
} from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { createSessionTokenService } from '../session-token.service.ts'
import { getFreshMaintenanceStateService } from '@/server/Maintenance/state.service.ts'
import type {
    CreateAuthenticatedSessionInput,
    CreateAuthenticatedSessionResult,
    PreparedLoginToken,
} from '@/server/Auth/Types/login-session.types.ts'

async function prepareTrustedDeviceToken(): Promise<PreparedLoginToken> {
    const token = crypto.randomUUID()
    return {
        token,
        hash: await createTokenHash(token),
        expiresAt: new Date(Date.now() + trustedDeviceConfig.durationMs),
    }
}

export async function createAuthenticatedSessionForUser({
    user,
    proof,
    auditAction,
    auditMessage,
}: CreateAuthenticatedSessionInput): Promise<CreateAuthenticatedSessionResult> {
    const meta = await getClientRequestMeta()
    const { isActive: isMaintenanceModeActive } =
        await getFreshMaintenanceStateService()

    const auditContext = prepareAuditContextService(user.id)
    const result = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select()
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1)
            .for('update')
        const currentUser = lockedUsers.at(0)

        if (
            !currentUser ||
            !currentUser.isActive ||
            currentUser.isDeleted ||
            currentUser.passwordHash !== user.passwordHash ||
            currentUser.email !== user.email ||
            currentUser.username !== user.username ||
            currentUser.isTwoFactorEnabled !== user.isTwoFactorEnabled
        ) {
            return null
        }

        if (proof.kind === 'password' || proof.kind === 'social') {
            const currentFactors = await transaction
                .select({
                    id: twoFactorAuth.id,
                    verified: twoFactorAuth.verified,
                })
                .from(twoFactorAuth)
                .where(eq(twoFactorAuth.userId, user.id))
                .limit(1)
            const currentFactor = currentFactors.at(0)
            const currentFactorId = currentFactor?.verified
                ? currentFactor.id
                : null

            if (
                Boolean(currentFactor?.verified) !==
                    currentUser.isTwoFactorEnabled ||
                currentFactorId !== proof.factorId ||
                (proof.kind === 'password' &&
                    proof.trustThisDevice &&
                    !currentUser.isTwoFactorEnabled)
            ) {
                return null
            }
        }

        if (proof.kind === 'social') {
            const accounts = await transaction
                .select({ id: socialAccounts.id })
                .from(socialAccounts)
                .where(
                    and(
                        eq(socialAccounts.id, proof.accountId),
                        eq(socialAccounts.userId, currentUser.id),
                    ),
                )
                .limit(1)
                .for('share')
            if (accounts.length !== 1) return null
        }

        if (proof.kind === 'passkey') {
            const updatedPasskeys = await transaction
                .update(passkeyCredentials)
                .set({
                    counter: proof.newCounter,
                    lastUsedAt: new Date(),
                })
                .where(
                    and(
                        eq(passkeyCredentials.id, proof.passkeyId),
                        eq(passkeyCredentials.userId, user.id),
                        eq(passkeyCredentials.counter, proof.counter),
                    ),
                )
                .returning({ id: passkeyCredentials.id })

            if (updatedPasskeys.length !== 1) {
                return null
            }
        }

        const permissionRows = await transaction
            .select({ key: permissions.key })
            .from(accountPermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, accountPermissions.permissionId),
            )
            .where(eq(accountPermissions.userId, user.id))
        const userPermissionKeys = permissionRows.map(
            (permission) => permission.key,
        )
        const redirectTo =
            isMaintenanceModeActive &&
            !hasPermission(
                userPermissionKeys,
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
            )
                ? '/maintenance'
                : getDefaultRouteForPermissions(userPermissionKeys)
        const publicUser = {
            id: currentUser.id,
            username: currentUser.username,
            email: currentUser.email,
            isActive: currentUser.isActive,
            permissions: userPermissionKeys,
        }

        if (redirectTo === '/login') {
            const auditReceipt = await writeAuditLogInTransactionService(
                transaction,
                {
                    ...auditContext,
                    action: 'auth.login_without_permissions',
                    message: `Benutzer ${user.username} wurde direkt wieder abgemeldet, weil keine Rechte vorhanden sind.`,
                },
            )
            return {
                redirectTo,
                user: publicUser,
                auditReceipt,
                session: null,
                device: null,
            }
        }

        const device =
            proof.kind === 'password' && proof.trustThisDevice
                ? await prepareTrustedDeviceToken()
                : null
        const session = await createSessionTokenService()

        await transaction.insert(sessions).values({
            id: session.hash,
            userId: user.id,
            expiresAt: session.expiresAt,
            ip: meta.ip,
            location: meta.location,
            device: meta.device,
            browser: meta.browser,
        })

        if (device) {
            await transaction.insert(trustedDevices).values({
                userId: user.id,
                deviceTokenHash: device.hash,
                expiresAt: device.expiresAt,
                ip: meta.ip,
                location: meta.location,
                device: meta.device,
                browser: meta.browser,
            })
        }

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            { ...auditContext, action: auditAction, message: auditMessage },
        )
        return { redirectTo, user: publicUser, auditReceipt, session, device }
    })

    if (!result) {
        return {
            success: false as const,
            code: 'INVALID_CREDENTIALS' as const,
            error: 'Ungültige Anmeldedaten.',
        }
    }

    await publishCommittedAuditLogService(result.auditReceipt)

    if (!result.session) {
        deleteCookie(SESSION_COOKIE_NAME, { path: '/' })

        return {
            success: true as const,
            redirectTo: '/login',
            loggedOutDueToMissingPermissions: true,
            error: 'Du wurdest wieder ausgeloggt, weil dein Benutzer keine Rechte hat.',
            user: result.user,
        }
    }

    const { session, device } = result
    try {
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax' as const,
            path: '/',
        }
        setCookie(SESSION_COOKIE_NAME, session.token, {
            ...cookieOptions,
            expires: session.absoluteExpiresAt,
        })
        if (device) {
            setCookie(TRUSTED_DEVICE_COOKIE_NAME, device.token, {
                ...cookieOptions,
                expires: device.expiresAt,
            })
        }
    } catch (error) {
        try {
            const cleanupReceipt = await db.transaction(
                async function (transaction) {
                    const cleanupUsers = await transaction
                        .select({ id: users.id })
                        .from(users)
                        .where(eq(users.id, user.id))
                        .limit(1)
                        .for('update')
                    await transaction
                        .delete(sessions)
                        .where(
                            and(
                                eq(sessions.id, session.hash),
                                eq(sessions.userId, user.id),
                            ),
                        )
                    if (device) {
                        await transaction
                            .delete(trustedDevices)
                            .where(
                                and(
                                    eq(trustedDevices.userId, user.id),
                                    eq(
                                        trustedDevices.deviceTokenHash,
                                        device.hash,
                                    ),
                                ),
                            )
                    }
                    return writeAuditLogInTransactionService(transaction, {
                        ...auditContext,
                        actorUserId: cleanupUsers.at(0)?.id ?? null,
                        action: 'auth.login_session_cancelled',
                        message:
                            'Anmeldesitzung wurde nach fehlgeschlagener Cookie-Ausgabe verworfen.',
                        newValues: { targetUserId: user.id },
                    })
                },
            )
            await publishCommittedAuditLogService(cleanupReceipt)
        } finally {
            deleteCookie(SESSION_COOKIE_NAME, { path: '/' })
            if (device) {
                deleteCookie(TRUSTED_DEVICE_COOKIE_NAME, { path: '/' })
            }
        }
        throw error
    }

    return {
        success: true as const,
        redirectTo: result.redirectTo,
        user: result.user,
    }
}
