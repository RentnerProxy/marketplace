import { BACKUP_INTEGRITY_VERSION } from '@/config/backup.config.ts'
import { z } from 'zod'
export const backupArchiveIntegritySchema = z
    .object({
        version: z.literal(BACKUP_INTEGRITY_VERSION),
        algorithm: z.literal('hmac-sha256'),
        entryCount: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
        hmacSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
