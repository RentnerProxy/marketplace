import type { createBackupAuditMocks } from './backupAuditTestUtils.ts'

export type BackupAuditHarness = ReturnType<typeof createBackupAuditMocks>

export type BackupMutationRevocation =
    'permission' | 'inactive' | 'deleted' | 'missing'

export type BackupMutationPolicyState = {
    exists: boolean
    isActive: boolean
    isDeleted: boolean
    permissionKeys: Array<string>
    beforeLock: (() => void | Promise<void>) | null
}
