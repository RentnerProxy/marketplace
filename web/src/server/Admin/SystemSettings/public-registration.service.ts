import { eq } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import { publishSystemSettingsUpdatedService } from '@/server/Realtime/publish.service.ts'
import {
    getOrCreateSystemSettingsForUpdateService,
    SYSTEM_SETTINGS_ID,
} from './settings.service.ts'

export async function updatePublicRegistrationService(
    isEnabled: boolean,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const committed = await db.transaction(async (transaction) => {
        await requireMutationPermissionService(
            transaction,
            actorUserId,
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        const previous =
            await getOrCreateSystemSettingsForUpdateService(transaction)
        if (previous.isPublicRegistrationEnabled === isEnabled) return null

        const [settings] = await transaction
            .update(systemSettings)
            .set({
                isPublicRegistrationEnabled: isEnabled,
                updatedAt: new Date(),
            })
            .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
            .returning()
        if (!settings) throw new Error('System settings row is unavailable')

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'admin.system.public_registration_updated',
                message: 'Öffentliche Registrierung wurde geändert.',
                oldValues: {
                    isPublicRegistrationEnabled:
                        previous.isPublicRegistrationEnabled,
                },
                newValues: {
                    isPublicRegistrationEnabled:
                        settings.isPublicRegistrationEnabled,
                },
            },
        )
        return { settings, auditReceipt }
    })

    if (committed) {
        const { settings, auditReceipt } = committed
        await publishCommittedAuditLogService(auditReceipt)
        await runBestEffortSideEffectService(
            'system_settings.public_registration_publish_failed',
            () =>
                publishSystemSettingsUpdatedService({
                    companyName: settings.companyName,
                    isPublicRegistrationEnabled:
                        settings.isPublicRegistrationEnabled,
                    updatedAt: settings.updatedAt.toISOString(),
                }),
        )
    }

    return { isPublicRegistrationEnabled: isEnabled }
}
