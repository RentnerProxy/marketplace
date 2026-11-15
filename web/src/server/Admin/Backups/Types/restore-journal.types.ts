export type RestoreJournalBinding = {
    restoreRunId: string
    actorUserId: string
    sourceBackupId: string
    sourceChecksumSha256: string
    includesStorage: boolean
}

type RestoreJournalAppendEvent =
    'rewind-ready' | 'applied' | 'completed' | 'failed' | 'recovery-required'

export type RestoreJournalEvent = 'started' | RestoreJournalAppendEvent

export type RestoreJournal = {
    append: (event: RestoreJournalAppendEvent) => Promise<void>
    close: () => Promise<void>
}

export type RestoreJournalUnsignedRecord = RestoreJournalBinding & {
    version: 1
    purpose: 'restore-journal-v1'
    algorithm: 'hmac-sha256'
    sequence: number
    event: RestoreJournalEvent
    occurredAt: string
    previousHmacSha256: string
}

export type RestoreJournalRecord = RestoreJournalUnsignedRecord & {
    hmacSha256: string
}
