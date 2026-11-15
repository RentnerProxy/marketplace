import type { BackupArchiveIntegrity } from '@/tests/server/Admin/Backups/archive-tar.test.types.ts'
import type { Header } from 'tar-stream'

export type LegacyTestBackupArchiveIntegrity = {
    version: 1
    algorithm: 'sha256'
    entryCount: number
    totalBytes: number
    checksumSha256: string
}

export type TestBackupArchiveIntegrity =
    BackupArchiveIntegrity | LegacyTestBackupArchiveIntegrity

export type TestTarEntry = {
    content?: Buffer | string
    linkname?: string
    name: string
    pax?: Record<string, string>
    type?: Header['type']
}
