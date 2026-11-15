import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { publishMaintenanceStateService } from '@/server/Maintenance/state.service.ts'
import { clearPendingMaintenanceExtensionRequest } from '@/server/Maintenance/requestStore.ts'
import {
    publishMaintenanceExtensionResolvedService,
    publishSystemSettingsUpdatedService,
} from '@/server/Realtime/publish.service.ts'
import type { UpdateMaintenanceModeInput } from '@/features/Admin/SystemSettings/Types/system-settings-server-input.types.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import {
    getOrCreateSystemSettingsForUpdateService,
    SYSTEM_SETTINGS_ID,
} from './settings.service.ts'

export async function updateMaintenanceModeService(
    data: UpdateMaintenanceModeInput,
    actorUserId: string,
) {
    const updatedAt = new Date()
    const maintenanceStartsAt = data.isEnabled ? new Date(data.startsAt) : null

    if (
        data.isEnabled &&
        (!maintenanceStartsAt || maintenanceStartsAt <= updatedAt)
    ) {
        return {
            success: false as const,
            error: 'Der Startzeitpunkt muss in der Zukunft liegen.',
        }
    }

    const auditContext = prepareAuditContextService(actorUserId)
    const { settings: committedSettings, auditReceipt: committedReceipt } =
        await db.transaction(async function (tx) {
            await requireMutationPermissionService(
                tx,
                actorUserId,
                PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
            const previousSettings =
                await getOrCreateSystemSettingsForUpdateService(tx)
            const [settings] = await tx
                .update(systemSettings)
                .set({
                    isMaintenanceModeEnabled: data.isEnabled,
                    maintenanceStartsAt,
                    updatedAt,
                })
                .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
                .returning()
            if (!settings) {
                throw new Error(
                    'Die Systemeinstellungen konnten nicht aktualisiert werden.',
                )
            }
            const auditReceipt = await writeAuditLogInTransactionService(tx, {
                ...auditContext,
                action: 'admin.system.maintenance_updated',
                message: 'Wartungsmodus wurde aktualisiert.',
                oldValues: {
                    isMaintenanceModeEnabled:
                        previousSettings.isMaintenanceModeEnabled,
                    maintenanceStartsAt:
                        previousSettings.maintenanceStartsAt?.toISOString() ??
                        null,
                },
                newValues: {
                    isMaintenanceModeEnabled: settings.isMaintenanceModeEnabled,
                    maintenanceStartsAt:
                        settings.maintenanceStartsAt?.toISOString() ?? null,
                },
            })
            return { settings, auditReceipt }
        })

    await publishCommittedAuditLogService(committedReceipt)
    let pendingRequestToReject = null

    if (!data.isEnabled) {
        try {
            pendingRequestToReject =
                await clearPendingMaintenanceExtensionRequest()
        } catch (error) {
            logError('maintenance.pending_request_clear_failed', error)
        }
    }

    await runBestEffortSideEffectService(
        'maintenance.settings_publish_failed',
        function () {
            return publishSystemSettingsUpdatedService({
                companyName: committedSettings.companyName,
                isMaintenanceModeEnabled: data.isEnabled,
                maintenanceStartsAt: maintenanceStartsAt?.toISOString(),
                updatedAt: updatedAt.toISOString(),
            })
        },
    )
    await runBestEffortSideEffectService(
        'maintenance.state_publish_failed',
        function () {
            return publishMaintenanceStateService(
                {
                    isMaintenanceModeEnabled: data.isEnabled,
                    maintenanceStartsAt,
                },
                updatedAt,
            )
        },
    )

    if (pendingRequestToReject) {
        await runBestEffortSideEffectService(
            'maintenance.resolution_publish_failed',
            function () {
                return publishMaintenanceExtensionResolvedService({
                    requestId: pendingRequestToReject.id,
                    userId: pendingRequestToReject.userId,
                    status: 'rejected',
                    maintenanceStartsAt: null,
                    resolvedAt: updatedAt.toISOString(),
                })
            },
            { requestId: pendingRequestToReject.id },
        )
    }

    return {
        success: true as const,
        isMaintenanceModeEnabled: data.isEnabled,
        maintenanceStartsAt: maintenanceStartsAt?.toISOString() ?? null,
    }
}
