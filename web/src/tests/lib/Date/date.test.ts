import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import { describe, expect, it } from 'bun:test'
import type { Column, RowData } from '@tanstack/react-table'
import { parseCalendarValue } from '@rentnerkev/calendar/value'

import {
    formatCountdown,
    formatDate,
    formatMaintenanceDate,
    formatNullableDate,
    formatRemainingTime,
    getCalendarRangeFilterValue,
    getDateRangeFilterValue,
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

    it('wandelt Kalenderbereiche nur bei mindestens einer Grenze um', function () {
        const from = new Date('2026-01-01T00:00:00.000Z')
        const to = new Date('2026-01-31T00:00:00.000Z')

        expect(getCalendarRangeFilterValue(from)).toBeUndefined()
        expect(getCalendarRangeFilterValue([null, null])).toBeUndefined()
        expect(getCalendarRangeFilterValue([from, null])).toEqual({
            from: from.toISOString(),
            to: undefined,
        })
        expect(getCalendarRangeFilterValue([null, to])).toEqual({
            from: undefined,
            to: to.toISOString(),
        })
    })

    it('übernimmt serialisierte Filter mit dem nativen Kalenderparser', function () {
        const from = '2026-01-01T00:00:00.000Z'
        const to = '2026-01-31T23:59:59.999Z'

        expect(
            getCalendarRangeFilterValue(parseCalendarValue([from, to])),
        ).toEqual({ from, to })
        expect(
            getCalendarRangeFilterValue(parseCalendarValue([from, null])),
        ).toEqual({ from, to: undefined })
        expect(
            getCalendarRangeFilterValue(parseCalendarValue([null, to])),
        ).toEqual({ from: undefined, to })
        expect(
            getCalendarRangeFilterValue(parseCalendarValue([null, null])),
        ).toBeUndefined()
    })

    it('verwirft ungültige Filtergrenzen ohne einen Kalendertag zu verschieben', function () {
        const to = '2026-03-31T23:59:59.999Z'

        for (const from of ['kein-datum', '2026-02-30T00:00:00.000Z']) {
            expect(
                getCalendarRangeFilterValue(parseCalendarValue([from, to])),
            ).toEqual({ from: undefined, to })
        }
    })

    it('liest vorhandene Tabellenfilter und liefert sonst ein leeres Objekt', function () {
        const value = { from: '2026-01-01', to: '2026-01-31' }
        const populatedColumn = {
            getFilterValue: function () {
                return value
            },
        } as Column<ClientTableFeatures, RowData>
        const emptyColumn = {
            getFilterValue: function () {
                return undefined
            },
        } as Column<ClientTableFeatures, RowData>

        expect(getDateRangeFilterValue(populatedColumn)).toBe(value)
        expect(getDateRangeFilterValue(emptyColumn)).toEqual({})
    })

    it.each(
        [null, '2026-01-01', [], { from: 42 }, { to: false }].map((value) => ({
            value,
        })),
    )(
        'verwirft einen Filter ohne gültigen Bereichsvertrag: %p',
        function ({ value }) {
            const column = { getFilterValue: () => value } as Column<
                ClientTableFeatures,
                RowData
            >
            expect(getDateRangeFilterValue(column)).toEqual({})
        },
    )
})
