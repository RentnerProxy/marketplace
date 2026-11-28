import { describe, expect, it } from 'bun:test'
import {
    BACKUP_FAILURE_MESSAGE,
    getStoredBackupErrorMessageService,
} from '@/server/Admin/Backups/backup.errors.ts'

describe('Backup error persistence boundary', function () {
    it('exports the exact safe operational message', function () {
        expect(BACKUP_FAILURE_MESSAGE).toBe(
            'Der Backup-Vorgang ist fehlgeschlagen.',
        )
    })

    it('preserves an absent stored error', function () {
        expect(getStoredBackupErrorMessageService(null)).toBeNull()
    })

    it.each([
        'postgres://user:synthetic-secret@private-host/db SELECT credential FROM users',
        'C:\\private\\backup-target\\archive.tar: permission denied',
        'raw non-Error token',
        '',
        BACKUP_FAILURE_MESSAGE,
    ])('redacts every present stored message', function (errorMessage) {
        expect(getStoredBackupErrorMessageService(errorMessage)).toBe(
            BACKUP_FAILURE_MESSAGE,
        )
    })
})
