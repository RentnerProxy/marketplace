import type { z } from 'zod'
import type { archiveManifestSchema } from '../archive-core.schema.ts'

export type BackupManifest = z.infer<typeof archiveManifestSchema>

export type ValidatedBackupArchive = {
    archiveSize: number
    checksumSha256: string
    manifest: BackupManifest
}
