export type RestoreJournalBinding = {
    restoreRunId: string
    actorUserId: string
    sourceBackupId: string
    sourceChecksumSha256: string
    includesStorage: boolean
}

type RestoreJournalAppendEvent =
    'rewind-ready' | 'applied' | 'completed' | 'failed' | 'recovery-required'

export type RestoreJournal = {
    append: (event: RestoreJournalAppendEvent) => Promise<void>
    close: () => Promise<void>
}
