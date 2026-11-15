import type { RestoreState } from '@/server/Admin/Backups/Types/restore-state.types.ts'
import type { mailRestoreQuiescenceSchema } from '@/server/Queues/mail-restore-quiescence.schema.ts'
import type { z } from 'zod'
export type MailRestoreQuiescence = z.infer<typeof mailRestoreQuiescenceSchema>

export type RestoreObservation =
    { kind: 'known'; state: RestoreState | null } | { kind: 'unknown' }

export type StoredQuiescence = {
    record: MailRestoreQuiescence
    serialized: string
}

export type MailRestoreQuiescenceOptions = {
    queueNames: ReadonlyArray<string>
    activeDrainTimeoutMs?: number
    activeDrainPollIntervalMs?: number
    ownerLeaseMs?: number
}

export type CompleteRestoreQuiescence = (
    publishCompletedState: () => Promise<void>,
) => Promise<void>
