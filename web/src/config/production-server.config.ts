import { BACKUP_LIMITS } from './backup.config.ts'

export const PRODUCTION_HTTP_LIMITS = {
    idleTimeout: 60,
    maxRequestBodySize: BACKUP_LIMITS.maxArchiveBytes,
} as const
