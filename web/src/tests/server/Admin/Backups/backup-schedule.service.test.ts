import { describe, expect, it } from 'bun:test'
import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import {
    assertValidBackupTimezoneService,
    getBackupRepeatOptionsService,
} from '@/server/Admin/Backups/backup-schedule.service.ts'

const settings = {
    isEnabled: true,
    targetKey: 'local',
    scheduleType: 'daily',
    scheduleInterval: 1,
    scheduleWeekdays: '1,2,3,4,5',
    scheduleHour: 3,
    scheduleMinute: 15,
    retentionMode: 'count',
    retentionDays: 30,
    retentionCount: 10,
    includeStorage: true,
} satisfies BackupSettings

describe('Backup-Zeitplanung', function () {
    it('erzeugt tägliche und wochentagsbasierte Cron-Verträge mit Zeitzone', function () {
        expect(
            getBackupRepeatOptionsService(
                settings,
                'Europe/Berlin',
                new Date('2026-01-01T00:00:00.000Z'),
            ),
        ).toEqual({
            pattern: '15 3 * * *',
            tz: 'Europe/Berlin',
        })
        expect(
            getBackupRepeatOptionsService(
                { ...settings, scheduleType: 'weekdays' },
                'Europe/Berlin',
                new Date('2026-01-01T00:00:00.000Z'),
            ),
        ).toEqual({
            pattern: '15 3 * * 1,2,3,4,5',
            tz: 'Europe/Berlin',
        })
    })

    it('behält stündliche Intervalle unabhängig von der Zeitzone bei', function () {
        expect(
            getBackupRepeatOptionsService(
                {
                    ...settings,
                    scheduleInterval: 6,
                    scheduleType: 'interval-hours',
                },
                'Europe/Berlin',
                new Date('2026-01-01T00:00:00.000Z'),
            ),
        ).toEqual({ every: 6 * 60 * 60 * 1_000 })
    })

    it.each([
        ['Winterzeit', '2026-01-04T12:00:00.000Z', '2026-01-05T02:15:00.000Z'],
        ['Sommerzeit', '2026-07-05T12:00:00.000Z', '2026-07-06T01:15:00.000Z'],
    ])(
        'berechnet den nächsten Wochenstart in der lokalen %s',
        function (_label, now, expectedStart) {
            expect(
                getBackupRepeatOptionsService(
                    {
                        ...settings,
                        scheduleInterval: 2,
                        scheduleType: 'interval-weeks',
                    },
                    'Europe/Berlin',
                    new Date(now),
                ),
            ).toEqual({
                every: 2 * 7 * 24 * 60 * 60 * 1_000,
                startDate: new Date(expectedStart),
            })
        },
    )

    it('verschiebt einen bereits vergangenen Wochenstart um sieben Tage', function () {
        expect(
            getBackupRepeatOptionsService(
                {
                    ...settings,
                    scheduleType: 'interval-weeks',
                },
                'Europe/Berlin',
                new Date('2026-01-05T03:00:00.000Z'),
            ),
        ).toMatchObject({
            startDate: new Date('2026-01-12T02:15:00.000Z'),
        })
    })

    it('weist ungültige IANA-Zeitzonen mit dem bestehenden Fehler zurück', function () {
        expect(() =>
            assertValidBackupTimezoneService('Europe/Berlin'),
        ).not.toThrow()
        expect(() => assertValidBackupTimezoneService('UTC')).not.toThrow()
        expect(() =>
            assertValidBackupTimezoneService('Europe/Unbekannt'),
        ).toThrow('BACKUP_TIMEZONE enthält keine gültige Zeitzone.')
    })
})
