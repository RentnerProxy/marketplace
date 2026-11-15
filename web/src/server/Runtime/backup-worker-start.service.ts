import type {
    BackgroundBackupWorker,
    BackupWorkerStartCoordinatorOptions,
    BackgroundWorkerShutdownOptions,
} from './Types/backup-worker-start.types.ts'

export async function closeBackgroundWorkersService(
    input: BackgroundWorkerShutdownOptions,
) {
    try {
        await input.backupWorker?.close()
    } finally {
        await input.closeMailWorker()
    }
}

export function createBackupWorkerStartCoordinatorService(
    input: BackupWorkerStartCoordinatorOptions,
) {
    let backupWorker: BackgroundBackupWorker | null = null
    let pendingStart: Promise<BackgroundBackupWorker | null> | null = null
    let stopped = false

    async function startWhenAvailable() {
        if (stopped) return backupWorker
        if (backupWorker) {
            return backupWorker
        }

        if (pendingStart) {
            return pendingStart
        }

        pendingStart = (async function () {
            if ((await input.isRestoreQuiescenceActive()) || stopped) {
                return null
            }

            try {
                backupWorker = await input.startBackupWorker()
                return backupWorker
            } catch (error) {
                if (await input.isRestoreQuiescenceActive()) {
                    return null
                }

                throw error
            }
        })()

        try {
            return await pendingStart
        } finally {
            pendingStart = null
        }
    }

    return {
        getWorker: function () {
            return backupWorker
        },
        startWhenAvailable,
        stop: async function () {
            stopped = true
            await pendingStart
            return backupWorker
        },
    }
}
