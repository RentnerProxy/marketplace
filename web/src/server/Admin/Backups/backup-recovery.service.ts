import { BACKUP_TIMEOUTS } from '@/config/backup.config.ts'
import { getBackupQueue } from './backup.queue.ts'
import {
    getStaleActiveBackupRuns,
    markRunAsQueueFailed,
} from './run-registry.service.ts'

const LOST_QUEUE_JOB_ERROR = new Error(
    'Der flüchtige Valkey-Queuezustand ist verloren gegangen. Bitte starte den Vorgang erneut.',
)

export async function reconcileLostBackupQueueState(
    activeRunIds: ReadonlySet<string>,
    now = new Date(),
) {
    const cutoff = new Date(
        now.getTime() - BACKUP_TIMEOUTS.valkeyRecoveryGraceMs,
    )
    const staleRuns = await getStaleActiveBackupRuns(cutoff)
    const queue = getBackupQueue()

    await Promise.all(
        staleRuns.map(async function (run) {
            if (activeRunIds.has(run.id) || (await queue.getJob(run.id))) {
                return
            }

            await markRunAsQueueFailed(run.id, LOST_QUEUE_JOB_ERROR)
        }),
    )
}
