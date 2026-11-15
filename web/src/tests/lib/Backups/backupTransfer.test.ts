import { afterEach, describe, expect, it, vi } from 'bun:test'
import {
    failBackupTransfer,
    triggerBackupDownload,
} from '@/lib/Backups/backupTransfer.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

afterEach(restoreTestGlobals)

describe('backup transfer browser boundary', function () {
    it('reports the original error and normalizes unknown failures', function () {
        const fail = vi.fn()
        const original = new Error('Synthetic transfer failure')
        expect(failBackupTransfer({ fail }, original, 'Fallback')).toBe(
            original,
        )
        expect(fail).toHaveBeenLastCalledWith('Synthetic transfer failure')
        const normalized = failBackupTransfer(
            { fail },
            null,
            'Transfer unavailable',
        )
        expect(normalized.message).toBe('Transfer unavailable')
        expect(fail).toHaveBeenLastCalledWith('Transfer unavailable')
    })

    it('assigns the intended filename and triggers only the synthetic download element', function () {
        const link = { href: '', download: '', click: vi.fn() }
        const createElement = vi.fn(() => link)
        stubTestGlobal('document', { createElement })
        triggerBackupDownload('blob:synthetic-backup', 'backup.encrypted.tar')
        expect(createElement).toHaveBeenCalledWith('a')
        expect(link.href).toBe('blob:synthetic-backup')
        expect(link.download).toBe('backup.encrypted.tar')
        expect(link.click).toHaveBeenCalledTimes(1)
    })
})
