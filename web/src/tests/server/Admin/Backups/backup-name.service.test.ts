import { describe, expect, it } from 'bun:test'
import { createBackupFileNameService } from '@/server/Admin/Backups/backup-name.service.ts'

describe('Backup-Dateinamen', () => {
    const createdAt = new Date('2026-11-13T07:47:44Z')

    it('verwendet den Firmennamen und die Backup-Zeitzone', () => {
        const name = createBackupFileNameService(
            'Öl & Sträßler GmbH',
            createdAt,
            'Europe/Berlin',
        )
        expect(name).toMatch(
            /^Oel-Straessler-GmbH-2026-11-13-08\.47\.44-[a-f0-9]{12}-backup\.enc$/,
        )
    })

    it('verhindert Pfadbestandteile, Headerzeichen und überlange Dateinamen', () => {
        const name = createBackupFileNameService(
            '../\\Company\r\n"'.repeat(100),
            createdAt,
            'UTC',
        )
        expect(name).toMatch(/^[a-zA-Z0-9.-]+$/)
        expect(name).not.toContain('..')
        expect(name.length).toBeLessThan(180)
        expect(name).toContain('-2026-11-13-07.47.44-')
    })

    it('verwendet bei einem unbrauchbaren Namen einen Fallback', () => {
        expect(createBackupFileNameService(' / . ', createdAt, 'UTC')).toMatch(
            /^rentnerproxy-marketplace-2026-11-13-/,
        )
    })

    it('unterscheidet Backups aus derselben Sekunde', () => {
        const first = createBackupFileNameService('Firma', createdAt, 'UTC')
        const second = createBackupFileNameService('Firma', createdAt, 'UTC')
        expect(first).not.toBe(second)
    })
})
