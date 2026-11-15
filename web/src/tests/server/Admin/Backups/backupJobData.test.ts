import { describe, expect, it } from 'bun:test'
import {
    backupFailureJobDataSchema,
    backupJobDataSchema,
    parseBackupJobContract,
} from '@/server/Admin/Backups/backup.queue.ts'

describe('Backup-Jobvertrag', function () {
    it('liest Restore-Jobs weiterhin über den kompatiblen v2-Vertrag', function () {
        expect(
            backupJobDataSchema.parse({
                contractVersion: 2,
                kind: 'restore',
                runId: '019f5b07-80e2-7000-8000-000000000001',
                sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
            }),
        ).toMatchObject({ contractVersion: 2, kind: 'restore' })
    })

    it.each([
        { kind: 'restore', runId: 'invalid', sourceBackupId: 'invalid' },
        {
            kind: 'restore',
            runId: '019f5b07-80e2-7000-8000-000000000001',
            sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
        },
        {
            contractVersion: 3,
            initiatingSessionHash: 'a'.repeat(64),
            kind: 'restore',
            runId: '019f5b07-80e2-7000-8000-000000000001',
            sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
        },
        { kind: 'create', trigger: 'unknown' },
        { kind: 'create', trigger: 'restore-safety' },
        { kind: 'create', trigger: 'manual', unexpected: true },
    ])('verwirft ungültige oder erweiterte Jobdaten', function (data) {
        expect(() => backupJobDataSchema.parse(data)).toThrow()
    })

    it('erkennt Legacy-Restore-Jobs ausschließlich für die Fehlerpersistierung', function () {
        const legacyRestoreJob = {
            kind: 'restore',
            runId: '019f5b07-80e2-7000-8000-000000000001',
            sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
        } as const

        expect(backupFailureJobDataSchema.parse(legacyRestoreJob)).toEqual(
            legacyRestoreJob,
        )
        expect(() =>
            parseBackupJobContract('restore-backup', legacyRestoreJob),
        ).toThrow()
    })

    it('koppelt Queue-Namen strikt an den diskriminierten Jobtyp', function () {
        const manualJob = {
            kind: 'create',
            trigger: 'manual',
            runId: '019f5b07-80e2-7000-8000-000000000001',
        }

        expect(
            parseBackupJobContract('manual-backup', manualJob),
        ).toMatchObject(manualJob)
        expect(() =>
            parseBackupJobContract('restore-backup', manualJob),
        ).toThrow(/stimmen nicht überein/)
    })
})
