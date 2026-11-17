import { db } from '@/db'
import { and, eq, ne } from 'drizzle-orm'
import {
    permissions,
    systemSettings,
    staffUserPermissions,
    users,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { createNotificationsService } from '@/server/Notifications/update.service.ts'
import { publishMaintenanceExtensionRequestedService } from '@/server/Realtime/publish.service.ts'
import type { RequestMaintenanceExtensionInput } from '@/features/Maintenance/Types/maintenance-server-input.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import {
    clearPendingMaintenanceExtensionRequest,
    getPendingMaintenanceExtensionRequest,
    setPendingMaintenanceExtensionRequest,
} from './requestStore.ts'
import { deriveMaintenanceState } from './state.service.ts'

async function notifyMaintenanceAdmins(request: {
    id: string
    userId: string
    username: string
}) {
    const adminRows = await db
        .select({ userId: users.id })
        .from(staffUserPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, staffUserPermissions.permissionId),
        )
        .innerJoin(users, eq(users.id, staffUserPermissions.userId))
        .where(
            and(
                eq(permissions.key, PERMISSIONS.ADMIN_SYSTEM_SETTINGS),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
                ne(users.id, request.userId),
            ),
        )

    await createNotificationsService(
        adminRows.map(function (admin) {
            return {
                userId: admin.userId,
                title: 'Neuer Wartungsantrag',
                message: `${request.username} bittet um eine Verschiebung des Wartungsstarts.`,
                type: 'maintenance-extension-requested',
                referenceId: request.id,
            }
        }),
    )
}

export async function requestMaintenanceExtensionService(
    data: RequestMaintenanceExtensionInput,
) {
    const user = await getActiveCurrentSessionUser()

    if (!user) {
        return {
            success: false as const,
            error: 'Deine Sitzung ist nicht mehr gültig.',
        }
    }

    const permissionKeys = await getUserPermissionKeys(user.id)

    if (hasPermission(permissionKeys, PERMISSIONS.ADMIN_MAINTENANCE_BYPASS)) {
        return {
            success: false as const,
            error: 'Du darfst den Wartungsmodus bereits umgehen.',
        }
    }

    const settingsRows = await db.select().from(systemSettings).limit(1)
    const settings = settingsRows.at(0)
    const maintenanceState = deriveMaintenanceState(settings, new Date())

    if (!maintenanceState.isScheduled) {
        return {
            success: false as const,
            error: 'Der Wartungsmodus ist nicht geplant.',
        }
    }

    if (await getPendingMaintenanceExtensionRequest()) {
        return {
            success: false as const,
            error: 'Es gibt bereits einen offenen Verschiebungsantrag.',
        }
    }

    const request = {
        id: Bun.randomUUIDv7(),
        userId: user.id,
        username: user.username,
        reason: data.reason,
        requestedAt: new Date(),
    }

    const wasStored = await setPendingMaintenanceExtensionRequest(request)

    if (!wasStored) {
        return {
            success: false as const,
            error: 'Es gibt bereits einen offenen Verschiebungsantrag.',
        }
    }

    try {
        await notifyMaintenanceAdmins(request)
    } catch (error) {
        await clearPendingMaintenanceExtensionRequest(request.id)
        throw error
    }

    try {
        await publishMaintenanceExtensionRequestedService({
            request: {
                id: request.id,
                reason: request.reason,
                requestedAt: request.requestedAt.toISOString(),
                user: {
                    id: request.userId,
                    username: request.username,
                },
            },
        })
    } catch (error) {
        logError('maintenance.request.realtime_publish_failed', error, {
            requestId: request.id,
        })
    }

    return {
        success: true as const,
        request: {
            id: request.id,
            reason: request.reason,
            requestedAt: request.requestedAt.toISOString(),
            user: {
                id: request.userId,
                username: request.username,
            },
        },
    }
}
