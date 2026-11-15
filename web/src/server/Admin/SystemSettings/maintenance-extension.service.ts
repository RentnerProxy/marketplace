import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { publishMaintenanceStateService } from '@/server/Maintenance/state.service.ts'
import {
    clearPendingMaintenanceExtensionRequest,
    getPendingMaintenanceExtensionRequest,
    setPendingMaintenanceExtensionRequest,
} from '@/server/Maintenance/requestStore.ts'
import {
    publishMaintenanceExtensionResolvedService,
    publishSystemSettingsUpdatedService,
} from '@/server/Realtime/publish.service.ts'
import type { ResolveMaintenanceExtensionRequestInput } from '@/features/Admin/SystemSettings/Types/system-settings-server-input.types.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import {
    DEFAULT_COMPANY_NAME,
    getOrCreateSystemSettingsForUpdateService,
    SYSTEM_SETTINGS_ID,
} from './settings.service.ts'

export async function resolveMaintenanceExtensionRequestService(
    data: ResolveMaintenanceExtensionRequestInput,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const now = new Date()
    const request = await getPendingMaintenanceExtensionRequest()

    if (!request || request.id !== data.requestId) {
        return {
            success: false as const,
            error: 'Der Antrag ist nicht mehr offen.',
        }
    }

    let resolvedMaintenanceStartsAt: Date | null = null
    let resolvedCompanyName = DEFAULT_COMPANY_NAME
    let resolvedMaintenanceEnabled = false

    let requestWasClaimed = false
    let auditReceipt: AuditReceipt | null
    try {
        auditReceipt = await db.transaction(async function (tx) {
            await requireMutationPermissionService(
                tx,
                actorUserId,
                PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
            const clearedRequest =
                await clearPendingMaintenanceExtensionRequest(request.id)
            if (!clearedRequest) return null
            requestWasClaimed = true
            const settings = await getOrCreateSystemSettingsForUpdateService(tx)
            resolvedCompanyName = settings.companyName

            if (data.status === 'approved') {
                const currentStartsAt =
                    settings.maintenanceStartsAt &&
                    settings.maintenanceStartsAt > now
                        ? settings.maintenanceStartsAt
                        : now
                const maintenanceStartsAt = new Date(
                    currentStartsAt.getTime() +
                        (data.extensionMinutes ?? 10) * 60 * 1000,
                )
                const [updated] = await tx
                    .update(systemSettings)
                    .set({
                        isMaintenanceModeEnabled: true,
                        maintenanceStartsAt,
                        updatedAt: now,
                    })
                    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
                    .returning()
                if (!updated) {
                    throw new Error(
                        'Die Systemeinstellungen konnten nicht aktualisiert werden.',
                    )
                }
                resolvedMaintenanceStartsAt = updated.maintenanceStartsAt
                resolvedMaintenanceEnabled = updated.isMaintenanceModeEnabled
            } else {
                resolvedMaintenanceStartsAt = settings.maintenanceStartsAt
                resolvedMaintenanceEnabled = settings.isMaintenanceModeEnabled
            }

            return writeAuditLogInTransactionService(tx, {
                ...auditContext,
                action: 'admin.system.maintenance_extension_resolved',
                message: `Wartungsverlängerung wurde ${data.status === 'approved' ? 'angenommen' : 'abgelehnt'}.`,
                oldValues: {
                    isMaintenanceModeEnabled: settings.isMaintenanceModeEnabled,
                    maintenanceStartsAt:
                        settings.maintenanceStartsAt?.toISOString() ?? null,
                },
                newValues: {
                    requestId: request.id,
                    userId: request.userId,
                    status: data.status,
                    maintenanceStartsAt:
                        resolvedMaintenanceStartsAt?.toISOString() ?? null,
                },
            })
        })
    } catch (error) {
        if (!requestWasClaimed) throw error
        try {
            const restored =
                await setPendingMaintenanceExtensionRequest(request)

            if (!restored) {
                logError(
                    'maintenance.request_compensation_conflict',
                    new Error(
                        'Der beanspruchte Wartungsantrag konnte nicht wiederhergestellt werden.',
                    ),
                    { requestId: request.id },
                )
            }
        } catch (compensationError) {
            logError(
                'maintenance.request_compensation_failed',
                compensationError,
                { requestId: request.id },
            )
        }

        throw error
    }

    if (!auditReceipt) {
        return {
            success: false as const,
            error: 'Der Antrag wurde bereits bearbeitet.',
        }
    }

    await publishCommittedAuditLogService(auditReceipt)

    if (data.status === 'approved') {
        await runBestEffortSideEffectService(
            'maintenance.settings_publish_failed',
            function () {
                return publishSystemSettingsUpdatedService({
                    companyName: resolvedCompanyName,
                    isMaintenanceModeEnabled: true,
                    maintenanceStartsAt:
                        resolvedMaintenanceStartsAt?.toISOString(),
                    updatedAt: now.toISOString(),
                })
            },
            { requestId: request.id },
        )
    }

    await runBestEffortSideEffectService(
        'maintenance.state_publish_failed',
        function () {
            return publishMaintenanceStateService(
                {
                    isMaintenanceModeEnabled: resolvedMaintenanceEnabled,
                    maintenanceStartsAt: resolvedMaintenanceStartsAt,
                },
                now,
            )
        },
        { requestId: request.id },
    )
    await runBestEffortSideEffectService(
        'maintenance.resolution_publish_failed',
        function () {
            return publishMaintenanceExtensionResolvedService({
                requestId: request.id,
                userId: request.userId,
                status: data.status,
                maintenanceStartsAt:
                    resolvedMaintenanceStartsAt?.toISOString() ?? null,
                resolvedAt: now.toISOString(),
            })
        },
        { requestId: request.id },
    )

    return { success: true as const }
}
