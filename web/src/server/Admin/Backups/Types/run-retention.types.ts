export type BackupDeletionActor =
    { kind: 'user'; userId: string } | { kind: 'retention' }
