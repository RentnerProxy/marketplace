import { describe, expect, it } from 'bun:test'
import {
    createTimestampRangeFilter,
    createTrimmedIncludesStringFilter,
} from '@/lib/Table/tableFilters.ts'

function createRow(value: unknown) {
    return {
        getValue: function () {
            return value
        },
    }
}

function addMeta() {}

describe('Tabellen-Zeitfilter', function () {
    const filter = createTimestampRangeFilter<Record<string, unknown>>()

    it('akzeptiert Werte innerhalb des Zeitraums', function () {
        const row = createRow('2026-07-01T10:30:00.000Z')

        expect(
            filter(
                row as unknown as Parameters<typeof filter>[0],
                'createdAt',
                {
                    from: '2026-07-01T10:00:00.000Z',
                    to: '2026-07-01T10:30:00.000Z',
                },
                function () {},
            ),
        ).toBe(true)
    })

    it('verwirft ungültige und außerhalb liegende Werte', function () {
        expect(
            filter(
                createRow('ungültig') as unknown as Parameters<
                    typeof filter
                >[0],
                'createdAt',
                {},
                addMeta,
            ),
        ).toBe(false)
        expect(
            filter(
                createRow('2026-07-01T09:00:00.000Z') as unknown as Parameters<
                    typeof filter
                >[0],
                'createdAt',
                { from: '2026-07-01T10:00:00.000Z' },
                addMeta,
            ),
        ).toBe(false)
    })
})

describe('Tabellen-Textfilter', function () {
    const filter = createTrimmedIncludesStringFilter<Record<string, unknown>>()

    it('normalisiert Leerzeichen und Großschreibung', function () {
        const filterValue = filter.resolveFilterValue?.('  ADA  ') ?? '  ADA  '

        expect(
            filter(
                createRow('Ada Lovelace') as unknown as Parameters<
                    typeof filter
                >[0],
                'username',
                filterValue,
                addMeta,
            ),
        ).toBe(true)
    })
})
