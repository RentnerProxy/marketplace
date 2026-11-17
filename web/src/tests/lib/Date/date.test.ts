import { describe, expect, it } from 'bun:test'

import {
    formatCountdown,
    formatDate,
    formatMaintenanceDate,
    formatNullableDate,
    formatRemainingTime,
} from '@/lib/Date/date.ts'

describe('Datumsformatierung', function () {
    it('formatiert vorhandene und fehlende Zeitstempel konsistent', function () {
        const value = new Date('2026-02-03T09:05:00.000Z')

        expect(formatDate(value)).toBe(
            new Intl.DateTimeFormat('de-DE', {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(value),
        )
        expect(formatNullableDate(value)).toBe(formatDate(value))
        expect(formatNullableDate(null)).toBe('Unbekannt')
        expect(formatNullableDate(undefined, 'Nie')).toBe('Nie')
    })

    it('begrenzt Restzeiten bei null und zeigt Tagesanteile nur bei Bedarf', function () {
        expect(formatRemainingTime(-1)).toBe('00:00:00')
        expect(formatRemainingTime(3_661_999)).toBe('01:01:01')
        expect(formatCountdown(-1)).toBe('00h 00m 00s')
        expect(formatCountdown(90_061_000)).toBe('1d 01h 01m 01s')
    })

    it('akzeptiert Wartungstermine als Date, String oder Range', function () {
        const value = new Date('2026-06-15T11:30:00.000Z')
        const expected = new Intl.DateTimeFormat('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(value)

        expect(formatMaintenanceDate(value)).toBe(expected)
        expect(formatMaintenanceDate(value.toISOString())).toBe(expected)
        expect(formatMaintenanceDate([value, null])).toBe(expected)
        expect(formatMaintenanceDate([null, value])).toBe('-')
        expect(formatMaintenanceDate('kein-datum')).toBe('-')
        expect(formatMaintenanceDate(null)).toBe('-')
    })
})
