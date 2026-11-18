import { getCookie } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    sessions,
    accountPermissions,
    user_profiles,
    user_settings,
    users,
} from '@/db/schema.ts'
import { SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getSessionTokenCandidateService } from './session-token.service.ts'
import {
    isUserFontFamily,
    isUserFontSize,
} from '@/lib/Theme/userFontSettings.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import { getMaintenanceStateService } from '@/server/Maintenance/state.service.ts'

export async function validateSessionService() {
    const candidate = await getSessionTokenCandidateService(
        getCookie(SESSION_COOKIE_NAME),
    )

    if (!candidate) {
        return {
            user: null,
            maintenance: await getMaintenanceStateService(),
        }
    }

    const sessionResult = await db
        .select({
            user: users,
            profile: user_profiles,
            settings: user_settings,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .leftJoin(user_settings, eq(user_settings.userId, users.id))
        .where(eq(sessions.id, candidate.sessionHash))
        .limit(1)

    const session = sessionResult.at(0)

    if (
        !session ||
        !(
            Math.min(
                session.expiresAt.getTime(),
                candidate.absoluteExpiresAt.getTime(),
            ) > Date.now()
        ) ||
        !session.user.isActive ||
        session.user.isDeleted
    ) {
        return {
            user: null,
            maintenance: await getMaintenanceStateService(),
        }
    }

    const { passwordHash, emailVerifiedAt, ...sessionUser } = session.user
    void passwordHash
    const safeUser = {
        ...sessionUser,
        firstName: session.profile?.firstName ?? null,
        lastName: session.profile?.lastName ?? null,
        street: session.profile?.street ?? null,
        houseNumber: session.profile?.houseNumber ?? null,
        postalCode: session.profile?.postalCode ?? null,
        city: session.profile?.city ?? null,
        primaryColor: session.settings?.primaryColor ?? null,
        themeMode: isUserThemeMode(session.settings?.themeMode)
            ? session.settings.themeMode
            : null,
        fontFamily: isUserFontFamily(session.settings?.fontFamily)
            ? session.settings.fontFamily
            : null,
        fontSize: isUserFontSize(session.settings?.fontSize)
            ? session.settings.fontSize
            : null,
        customBackgroundUpdatedAt:
            session.settings?.customBackgroundUpdatedAt?.toISOString() ?? null,
        customBackgroundDarkness:
            session.settings?.customBackgroundDarkness ?? null,
        profileImageVersion:
            session.profile?.profileImageUpdatedAt?.getTime() ?? null,
    }

    const permissionRows = await db
        .select({ key: permissions.key })
        .from(accountPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, accountPermissions.permissionId),
        )
        .where(eq(accountPermissions.userId, session.user.id))

    const userPermissionKeys = permissionRows.map(
        (permission) => permission.key,
    )
    const maintenance = await getMaintenanceStateService()
    const expiresAtMs = Math.min(
        session.expiresAt.getTime(),
        candidate.absoluteExpiresAt.getTime(),
    )
    if (!(expiresAtMs > Date.now())) return { user: null, maintenance }

    return {
        user: safeUser,
        canSubmitMarketplaceApps:
            sessionUser.accountType === 'public' && Boolean(emailVerifiedAt),
        expiresAt: new Date(expiresAtMs).toISOString(),
        absoluteExpiresAt: candidate.absoluteExpiresAt.toISOString(),
        permissions: userPermissionKeys,
        maintenance,
        canBypassMaintenance: hasPermission(
            userPermissionKeys,
            PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
        ),
    }
}
