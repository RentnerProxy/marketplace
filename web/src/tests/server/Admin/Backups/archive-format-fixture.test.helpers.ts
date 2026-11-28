// Independent Node writer used only to create compatibility fixtures for the Rust reader.
import { createHmac, hkdfSync } from 'node:crypto'
import type {
    BackupTarEntry,
    BackupArchiveIntegrity,
} from '@/tests/server/Admin/Backups/archive-tar.test.types.ts'
import { encryptionKeySchema } from '@/server/Runtime/environment-schema.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
export const BACKUP_INTEGRITY_FILE_NAME = 'integrity.json'
const integrityVersion = 2
const TAR_INTEGRITY_PREFIX = Buffer.from(
    `tanstack-backup-integrity-v${integrityVersion}\0`,
    'utf8',
)
function encodeIntegrityEntry(entry: BackupTarEntry) {
    const pathBytes = Buffer.from(entry.path, 'utf8')
    const metadata = Buffer.allocUnsafe(4 + 1 + 8)
    metadata.writeUInt32BE(pathBytes.length, 0)
    metadata.writeUInt8(entry.type === 'file' ? 1 : 2, 4)
    metadata.writeBigUInt64BE(BigInt(entry.size), 5)
    return { metadata, pathBytes }
}

function getBackupIntegrityKey() {
    const parsedKey = encryptionKeySchema.safeParse(
        getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
    )

    if (!parsedKey.success) {
        throw new Error(
            'AUTH_ENCRYPTION_KEY muss ein Base64-kodierter 32-Byte-Schlüssel sein.',
        )
    }

    return Buffer.from(
        hkdfSync(
            'sha256',
            Buffer.from(parsedKey.data, 'base64'),
            'tanstack-backup-key-v1',
            'archive-integrity-v2',
            32,
        ),
    )
}

export function createBackupIntegrityTracker() {
    const hmac = createHmac('sha256', getBackupIntegrityKey())
    hmac.update(TAR_INTEGRITY_PREFIX)
    let activeEntry: BackupTarEntry | undefined
    let activeEntryBytes = 0
    let entryCount = 0
    let totalBytes = 0
    let completed = false

    function startEntry(entry: BackupTarEntry) {
        if (completed || activeEntry) {
            throw new Error('Der Backup-Integritätsstatus ist ungültig.')
        }

        const { metadata, pathBytes } = encodeIntegrityEntry(entry)
        hmac.update(metadata)
        hmac.update(pathBytes)
        activeEntry = entry
        activeEntryBytes = 0
        entryCount += 1

        if (entry.type === 'file') {
            totalBytes += entry.size
        }
    }

    function update(chunk: Uint8Array) {
        if (!activeEntry || activeEntry.type !== 'file') {
            throw new Error('Der Backup-Integritätsstatus ist ungültig.')
        }

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        activeEntryBytes += buffer.length

        if (activeEntryBytes > activeEntry.size) {
            throw new Error('Ein Backup-Eintrag überschreitet seine Größe.')
        }

        hmac.update(buffer)
    }

    function finishEntry() {
        if (!activeEntry || activeEntryBytes !== activeEntry.size) {
            throw new Error('Ein Backup-Eintrag besitzt eine ungültige Größe.')
        }

        activeEntry = undefined
        activeEntryBytes = 0
    }

    function complete(): BackupArchiveIntegrity {
        if (completed || activeEntry) {
            throw new Error('Der Backup-Integritätsstatus ist unvollständig.')
        }

        completed = true
        return {
            version: integrityVersion,
            algorithm: 'hmac-sha256',
            entryCount,
            totalBytes,
            hmacSha256: hmac.digest('hex'),
        }
    }

    return { complete, finishEntry, startEntry, update }
}
