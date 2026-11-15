import { randomUUID } from 'node:crypto'
import { BACKUP_ARCHIVE_EXTENSION } from '@/config/backup.config.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export function createBackupFileNameService(
    companyName: string,
    createdAt: Date,
    timeZone: string,
): string {
    const name = companyName
        .trim()
        .replaceAll('ä', 'ae')
        .replaceAll('ö', 'oe')
        .replaceAll('ü', 'ue')
        .replaceAll('Ä', 'Ae')
        .replaceAll('Ö', 'Oe')
        .replaceAll('Ü', 'Ue')
        .replaceAll('ß', 'ss')
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-zA-Z0-9-]+/g, '-')
        .slice(0, 80)
        .replace(/^-+|-+$/g, '')
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(createdAt)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((value) => value.type === type)?.value
    const date = `${part('year')}-${part('month')}-${part('day')}`
    const time = `${part('hour')}.${part('minute')}.${part('second')}`
    // Retain collision resistance for concurrent jobs, retries and DST overlap.
    const id = randomUUID().replaceAll('-', '').slice(0, 12)
    return `${name || PROJECT_CONFIG.packageName}-${date}-${time}-${id}-backup${BACKUP_ARCHIVE_EXTENSION}`
}
