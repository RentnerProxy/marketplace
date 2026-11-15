import { restoreStateSchema } from '@/server/Admin/Backups/restore-state.schema.ts'
import type {
    RestoreState,
    WriteRestoreStateInput,
} from '@/server/Admin/Backups/Types/restore-state.types.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'

import type { BackupRestoreProgress } from '@/lib/Backups/Types/backup.types.ts'
import { getBackupStoragePaths } from './backup-directory.service.ts'

function getFailClosedRestoreState(): RestoreState {
    const now = new Date().toISOString()

    return {
        version: 1,
        status: 'running',
        phase: 'preparing',
        percent: null,
        processedBytes: 0,
        totalBytes: 0,
        startedAt: now,
        updatedAt: now,
    }
}

export async function getRestoreStateService() {
    return runCoreCommandService(
        'storage',
        {
            operation: 'restoreStateGet',
            ...getBackupStoragePaths(),
        },
        {
            validateResult: (value) =>
                restoreStateSchema.nullable().parse(value),
        },
    )
}

export async function getPublicRestoreStateService() {
    try {
        return await getRestoreStateService()
    } catch {
        return getFailClosedRestoreState()
    }
}

export async function isRestoreStateActiveService() {
    try {
        const status = (await getRestoreStateService())?.status
        return status === 'running' || status === 'recovery-required'
    } catch {
        return true
    }
}

export async function writeRestoreStateService(input: WriteRestoreStateInput) {
    const state = restoreStateSchema.parse({
        version: 1,
        status: input.status,
        phase: input.phase,
        percent: input.percent,
        processedBytes: input.processedBytes,
        totalBytes: input.totalBytes,
        startedAt: input.startedAt,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
    })
    return runCoreCommandService(
        'storage',
        {
            operation: 'restoreStateWrite',
            ...getBackupStoragePaths(),
            state,
        },
        {
            validateResult(value) {
                const confirmed = restoreStateSchema.parse(value)
                if (JSON.stringify(confirmed) !== JSON.stringify(state)) {
                    throw new Error(
                        'Der gespeicherte Restore-Status konnte nicht bestätigt werden.',
                    )
                }
                return confirmed
            },
        },
    )
}

export function getRestoreStateFromProgress(
    progress: BackupRestoreProgress,
    startedAt: string,
) {
    return {
        status: 'running' as const,
        phase: progress.phase,
        percent: progress.percent,
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
        startedAt,
        updatedAt: progress.updatedAt,
    }
}
