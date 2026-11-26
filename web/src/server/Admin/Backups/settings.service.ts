import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { publishAdminBackupsChangedService } from '@/server/Realtime/publish.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { z } from 'zod'
import type {
    BackupSettingsDatabase,
    StoredBackupSettings,
} from './Types/settings.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { getStoredBackupErrorMessageService } from './backup.errors.ts'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { backupRuns, backupSettings } from '@/db/schema.ts'
import {
    BACKUP_SETTINGS_ID,
    BACKUP_TARGET_KEY,
} from '@/config/backup.config.ts'
import { DEFAULT_BACKUP_SETTINGS } from '@/config/backup.config.ts'
import {
    getNextScheduledBackupAt,
    syncBackupScheduler,
} from './backup.queue.ts'
import type {
    BackupRunStatus,
    BackupRunTrigger,
    BackupSettings,
    UpdateBackupSettingsInput,
} from '@/lib/Backups/Types/backup.types.ts'

const scheduleTypeSchema = z.enum([
    'daily',
    'weekdays',
    'interval-hours',
    'interval-weeks',
])
const retentionModeSchema = z.enum(['days', 'count', 'both'])
const runTriggerSchema: z.ZodType<BackupRunTrigger> = z.enum([
    'manual',
    'scheduled',
    'restore-safety',
    'import',
    'restore',
])
const runStatusSchema: z.ZodType<BackupRunStatus> = z.enum([
    'queued',
    'running',
    'completed',
    'failed',
])

export async function getOrCreateBackupSettings(
    database: BackupSettingsDatabase = db,
) {
    await database
        .insert(backupSettings)
        .values({
            id: BACKUP_SETTINGS_ID,
            ...DEFAULT_BACKUP_SETTINGS,
            targetKey: BACKUP_TARGET_KEY,
        })
        .onConflictDoNothing()

    const rows = await database
        .select()
        .from(backupSettings)
        .where(eq(backupSettings.id, BACKUP_SETTINGS_ID))
        .limit(1)
    const settings = rows.at(0)

    if (!settings) {
        throw new Error('Backup-Einstellungen konnten nicht geladen werden.')
    }

    if (settings.targetKey !== BACKUP_TARGET_KEY) {
        const updatedSettings = {
            ...settings,
            targetKey: BACKUP_TARGET_KEY,
            updatedAt: new Date(),
        }
        await database
            .update(backupSettings)
            .set({
                targetKey: updatedSettings.targetKey,
                updatedAt: updatedSettings.updatedAt,
            })
            .where(eq(backupSettings.id, BACKUP_SETTINGS_ID))
        return updatedSettings
    }

    return settings
}

export function serializeBackupSettings(
    settings: StoredBackupSettings,
): BackupSettings {
    return {
        isEnabled: settings.isEnabled,
        targetKey: BACKUP_TARGET_KEY,
        scheduleType: scheduleTypeSchema.parse(settings.scheduleType),
        scheduleInterval: settings.scheduleInterval,
        scheduleWeekdays: settings.scheduleWeekdays,
        scheduleHour: settings.scheduleHour,
        scheduleMinute: settings.scheduleMinute,
        retentionMode: retentionModeSchema.parse(settings.retentionMode),
        retentionDays: settings.retentionDays,
        retentionCount: settings.retentionCount,
        includeStorage: settings.includeStorage,
    }
}

export async function getBackupOverviewService() {
    const settings = await getOrCreateBackupSettings()
    const [runs, statsRows] = await Promise.all([
        db
            .select()
            .from(backupRuns)
            .orderBy(desc(backupRuns.startedAt))
            .limit(100),
        db
            .select({
                total: sql<number>`count(*)::int`,
                successful: sql<number>`count(*) filter (where ${backupRuns.status} = 'completed')::int`,
                failed: sql<number>`count(*) filter (where ${backupRuns.status} = 'failed')::int`,
                imported: sql<number>`count(*) filter (where ${backupRuns.trigger} = 'import' and ${backupRuns.status} = 'completed')::int`,
                restored: sql<number>`count(*) filter (where ${backupRuns.trigger} = 'restore' and ${backupRuns.status} = 'completed')::int`,
            })
            .from(backupRuns),
    ])
    const stats = statsRows.at(0) ?? {
        total: 0,
        successful: 0,
        failed: 0,
        imported: 0,
        restored: 0,
    }
    let nextBackupAt: string | null = null

    if (settings.isEnabled) {
        try {
            nextBackupAt =
                (await getNextScheduledBackupAt())?.toISOString() ?? null
        } catch {
            nextBackupAt = null
        }
    }

    return {
        settings: serializeBackupSettings(settings),
        stats,
        nextBackupAt,
        targets: [{ key: BACKUP_TARGET_KEY, label: 'Backups' }],
        runs: runs.map(function (run) {
            const { completedAt, startedAt, ...runData } = run

            return Object.assign(runData, {
                errorMessage: getStoredBackupErrorMessageService(
                    run.errorMessage,
                ),
                trigger: runTriggerSchema.parse(run.trigger),
                status: runStatusSchema.parse(run.status),
                completedAt: completedAt?.toISOString() ?? null,
                startedAt: startedAt.toISOString(),
            })
        }),
    }
}

export async function updateBackupSettingsService(
    data: UpdateBackupSettingsInput,
    userId: string,
) {
    const auditContext = prepareAuditContextService(userId)
    const updatedAt = new Date()
    const result = await db.transaction(async function (transaction) {
        await requireMutationPermissionService(
            transaction,
            userId,
            PERMISSIONS.ADMIN_BACKUPS,
        )
        const updated = await transaction
            .insert(backupSettings)
            .values({
                id: BACKUP_SETTINGS_ID,
                ...data,
                targetKey: BACKUP_TARGET_KEY,
                updatedAt,
                updatedByUserId: userId,
            })
            .onConflictDoUpdate({
                target: backupSettings.id,
                set: {
                    ...data,
                    targetKey: BACKUP_TARGET_KEY,
                    updatedAt,
                    updatedByUserId: userId,
                },
            })
            .returning()
        const updatedSettings = updated.at(0)

        if (!updatedSettings) {
            throw new Error(
                'Backup-Einstellungen konnten nicht gespeichert werden.',
            )
        }

        const savedSettings = serializeBackupSettings(updatedSettings)
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'admin.backups.settings_updated',
                message: 'Backup-Einstellungen wurden aktualisiert.',
                newValues: savedSettings,
            },
        )
        return { settings: savedSettings, auditReceipt }
    })

    await publishCommittedAuditLogService(result.auditReceipt)
    await syncBackupScheduler(result.settings)
    await publishAdminBackupsChangedService()
    return { success: true as const, settings: result.settings }
}
