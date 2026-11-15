export const DEFAULT_BACKUP_SETTINGS = {
    isEnabled: false,
    scheduleType: 'daily',
    scheduleInterval: 1,
    scheduleWeekdays: '1,2,3,4,5',
    scheduleHour: 3,
    scheduleMinute: 0,
    retentionMode: 'count',
    retentionDays: 30,
    retentionCount: 10,
    includeStorage: true,
} as const

export const BACKUP_SETTINGS_ID = 'default'
export const BACKUP_TARGET_KEY = 'local'
export const BACKUP_QUEUE_NAME = 'backups'
export const BACKUP_SCHEDULER_ID = 'nightly-backup'
export const BACKUP_ARCHIVE_EXTENSION = '.enc'
export const BACKUP_UPLOAD_CONTENT_TYPE = 'application/octet-stream'
export const BACKUP_MANIFEST_VERSION = 3
export const BACKUP_LEGACY_MANIFEST_VERSION = 2
export const BACKUP_PRIVATE_BACKGROUNDS_VERSION = 1
export const BACKUP_INTEGRITY_VERSION = 2

export const BACKUP_ARCHIVE_ENCRYPTION_CONFIG = {
    magic: 'TDBAKENC',
    version: 1,
    algorithm: 1,
    cipher: 'aes-256-gcm',
    hkdfDigest: 'sha256',
    hkdfInfo: 'tanstackdummy/backup/envelope-v1/aes-256-gcm',
    keyBytes: 32,
    saltBytes: 32,
    ivBytes: 12,
    headerBytes: 54,
    tagBytes: 16,
    chunkBytes: 65536,
} as const

export const BACKUP_INTEGRITY_KEY_DERIVATION = {
    salt: 'tanstack-backup-key-v1',
    info: 'archive-integrity-v2',
    length: 32,
} as const

export const BACKUP_CREATE_JOB_OPTIONS = {
    attempts: 2,
    backoff: { delay: 30000, type: 'exponential' as const },
} as const

export const BACKUP_POSTGRES_TIMEOUT_SECONDS = {
    default: 2 * 60 * 60,
    min: 60,
    max: 4 * 60 * 60,
} as const

export const BACKUP_TIMEOUTS = {
    maximumDownloadDurationMs: 60 * 60 * 1000,
    valkeyRecoveryGraceMs: 60000,
} as const

const maxArchiveEntries = 100000
const maxExtractedBytes = 25 * 1024 * 1024 * 1024
const maxArchivePathBytes = 4096
const maxArchivePathSegmentLength = 255
const maxArchivePathSegments = 64
const maxArchivePathTotalBytes = 16 * 1024 * 1024
const maxPaxHeaderBytes = maxArchivePathBytes + 512
const maxTarEntryOverheadBytes = 2 * 512 + maxPaxHeaderBytes + 2 * (512 - 1)
const maxPlaintextArchiveBytes =
    maxExtractedBytes + maxArchiveEntries * maxTarEntryOverheadBytes + 2 * 512
const maxArchiveBytes =
    maxPlaintextArchiveBytes +
    BACKUP_ARCHIVE_ENCRYPTION_CONFIG.headerBytes +
    BACKUP_ARCHIVE_ENCRYPTION_CONFIG.tagBytes

export const BACKUP_LIMITS = {
    maxArchiveBytes,
    maxPlaintextArchiveBytes,
    maxExtractedBytes,
    maxArchiveEntries,
    maxArchivePathBytes,
    maxArchivePathSegmentLength,
    maxArchivePathSegments,
    maxArchivePathTotalBytes,
    maxPaxHeaderBytes,
    maxManifestBytes: 64 * 1024,
    maxErrorLength: 1000,
} as const

export const BACKUP_FILE_PERMISSIONS = {
    directory: 0o700,
    file: 0o600,
} as const

export const BACKUP_IMPORT_LIMITS = {
    admissionDirectoryName: '.import-admission-v1',
    retryAfterSeconds: 5,
    maximumDurationMs: 60 * 60 * 1000,
    workingArchiveCopies: 2,
    diskHeadroomBytes: 1024 * 1024 * 1024,
    diskCheckIntervalBytes: 16 * 1024 * 1024,
} as const

export const BACKUP_RESTORE_JOURNAL = {
    directoryName: '.restore-journal-v1',
    version: 1,
    purpose: 'restore-journal-v1',
    maxBytes: 32 * 1024,
    maxEvents: 8,
} as const
