import { vi } from 'bun:test'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import type { BackupImportContext } from '@/server/Admin/Backups/Types/import.types.ts'

export function createBackupImportTestContext(
    temporaryDirectory: string,
    maximumUploadBytes = BACKUP_LIMITS.maxArchiveBytes,
    requestSignal?: AbortSignal,
) {
    const controller = new AbortController()
    const signal = requestSignal
        ? AbortSignal.any([controller.signal, requestSignal])
        : controller.signal
    const beforeWrite = vi.fn(async function (_byteLength: number) {})
    const markCleanupIncomplete = vi.fn()
    const assertActive = vi.fn(() => signal.throwIfAborted())
    const context: BackupImportContext = {
        signal,
        temporaryDirectory,
        maximumUploadBytes,
        beforeWrite,
        markCleanupIncomplete,
        assertActive,
    }
    return {
        context,
        controller,
        beforeWrite,
        markCleanupIncomplete,
        assertActive,
    }
}
