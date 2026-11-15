import { describe, expect, it, vi } from 'bun:test'
import { failBackupTransfer } from '@/lib/Backups/backupTransfer.ts'

describe('Backup-Client-Fehlerbehandlung', function () {
    it('markiert den Transfer mit der vorhandenen Fehlermeldung', function () {
        const fail = vi.fn()
        const error = new Error('Backup fehlgeschlagen')

        expect(failBackupTransfer({ fail }, error, 'Fallback')).toBe(error)
        expect(fail).toHaveBeenCalledWith('Backup fehlgeschlagen')
    })

    it('normalisiert unbekannte Fehler mit dem Fallback', function () {
        const fail = vi.fn()
        const error = failBackupTransfer(
            { fail },
            { reason: 'unknown' },
            'Fallback',
        )

        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Fallback')
        expect(fail).toHaveBeenCalledWith('Fallback')
    })
})
