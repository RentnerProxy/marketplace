import type { Header } from 'tar-stream'
import type { backupArchiveIntegritySchema } from '@/server/Admin/Backups/archive-integrity.schema.ts'
import type { z } from 'zod'
export type BackupArchiveIntegrity = z.infer<
    typeof backupArchiveIntegritySchema
>

export type BackupTarEntry = {
    path: string
    size: number
    type: 'directory' | 'file'
}

export type BackupTarHeader = Pick<Header, 'name' | 'size' | 'type'> &
    Partial<Pick<Header, 'linkname' | 'pax'>>
