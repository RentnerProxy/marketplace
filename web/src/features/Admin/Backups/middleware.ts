import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    requirePermissionService,
    requirePermissionWithSessionService,
} from '@/server/Auth/authorization.service.ts'
import {
    backupCreationProgressInputSchema,
    backupIdInputSchema,
    restoreBackupInputSchema,
    updateBackupSettingsInputSchema,
} from './validation.ts'
import {
    getBackupOverviewService,
    updateBackupSettingsService,
} from '@/server/Admin/Backups/settings.service.ts'
import { deleteBackupService } from '@/server/Admin/Backups/run-retention.service.ts'
import { enqueueRestoreBackupService } from '@/server/Admin/Backups/run-restore.service.ts'
import { getBackupCreationProgressService } from '@/server/Admin/Backups/progress.service.ts'

export const getBackupOverviewHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
    return getBackupOverviewService()
})

export const getBackupCreationProgressHandler = createServerFn({
    method: 'GET',
})
    .validator(backupCreationProgressInputSchema)
    .handler(async function ({ data }) {
        await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        return getBackupCreationProgressService(data.runId)
    })

export const updateBackupSettingsHandler = createServerFn({ method: 'POST' })
    .validator(updateBackupSettingsInputSchema)
    .handler(async function ({ data }) {
        const access = await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        return await updateBackupSettingsService(data, access.userId)
    })

export const deleteBackupHandler = createServerFn({ method: 'POST' })
    .validator(backupIdInputSchema)
    .handler(async function ({ data }) {
        const access = await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        return await deleteBackupService(data.backupId, access.userId)
    })

export const restoreBackupHandler = createServerFn({ method: 'POST' })
    .validator(restoreBackupInputSchema)
    .handler(async function ({ data }) {
        const access = await requirePermissionWithSessionService(
            PERMISSIONS.ADMIN_BACKUPS,
        )
        return await enqueueRestoreBackupService(
            data.backupId,
            access.userId,
            access.sessionHash,
            access.sessionExpiresAt,
        )
    })
