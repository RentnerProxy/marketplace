import type { CompleteRestoreQuiescence } from '@/server/Queues/Types/mail-restore-quiescence.types.ts'
export type StartBackupWorkerOptions = {
    isRestoreQuiescenceActive: () => Promise<boolean>
    runRestoreQuiesced: (
        operation: (
            completeRestoreQuiescence: CompleteRestoreQuiescence,
        ) => Promise<unknown>,
    ) => Promise<unknown>
}
