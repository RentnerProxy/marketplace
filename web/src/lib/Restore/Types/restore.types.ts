import type { BackupRestoreProgressPhase } from '@/lib/Backups/Types/backup.types.ts'

type RestoreStatusBase = {
    version: 1
    percent: number | null
    processedBytes: number
    totalBytes: number
    startedAt: string | null
    updatedAt: string | null
}

export type RestoreStatus =
    | (RestoreStatusBase & {
          status: 'idle'
          phase: null
      })
    | (RestoreStatusBase & {
          status: 'running' | 'completed' | 'failed' | 'recovery-required'
          phase: BackupRestoreProgressPhase
      })

export type RestoreNavigationBridgeOptions = {
    returnPath?: string | null
    preRestoreUserId?: string | null
    isPreRestoreIdentityResolved?: boolean
    clearStaleReturnPath?: boolean
}

export type RestoreReturnRecord = {
    version: 2
    path: string
    preRestoreUserId: string
    savedAt: number
}

export type RestoreReturnAccess = {
    currentUserId: string
    permissions: Array<string>
}
