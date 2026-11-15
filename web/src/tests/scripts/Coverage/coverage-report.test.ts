import { describe, expect, it } from 'bun:test'
import { TEST_COVERAGE_THRESHOLDS } from '@/scripts/Coverage/coverage.config.ts'
import {
    assertCoverageThresholds,
    parseCoverageReport,
} from '@/scripts/Coverage/coverage-report.ts'

function record(
    source: string,
    lines: number,
    linesHit: number,
    functions = lines,
    functionsHit = linesHit,
) {
    return `SF:${source}\nLF:${lines}\nLH:${linesHit}\nFNF:${functions}\nFNH:${functionsHit}\nend_of_record\n`
}

describe('global LCOV coverage thresholds', function () {
    it('weights actual covered counts across source files, retaining uncovered files in the denominator', function () {
        const summary = parseCoverageReport(
            record('large.ts', 999, 999) + record('small.ts', 1, 0),
        )
        expect(summary).toEqual({
            files: 2,
            lines: { found: 1000, hit: 999 },
            functions: { found: 1000, hit: 999 },
        })
        expect(
            assertCoverageThresholds(summary, TEST_COVERAGE_THRESHOLDS),
        ).toEqual({ lines: 0.999, functions: 0.999 })
        expect(() =>
            assertCoverageThresholds(
                parseCoverageReport(
                    record('large.ts', 999, 0) + record('small.ts', 1, 1),
                ),
                TEST_COVERAGE_THRESHOLDS,
            ),
        ).toThrow('below 90.00%')
    })

    it('accepts exactly 90% but rejects a percentage which only rounds up to it', function () {
        expect(() =>
            assertCoverageThresholds(
                parseCoverageReport(record('exact.ts', 10, 9)),
                TEST_COVERAGE_THRESHOLDS,
            ),
        ).not.toThrow()
        expect(() =>
            assertCoverageThresholds(
                parseCoverageReport(record('rounded.ts', 100_000, 89_999)),
                TEST_COVERAGE_THRESHOLDS,
            ),
        ).toThrow('below 90.00%')
    })

    it('checks line and function coverage independently and retains function-free configuration records', function () {
        const summary = parseCoverageReport(
            record('config.ts', 10, 10, 0, 0) +
                record('behavior.ts', 10, 10, 10, 8),
        )
        expect(summary.lines).toEqual({ found: 20, hit: 20 })
        expect(() =>
            assertCoverageThresholds(summary, TEST_COVERAGE_THRESHOLDS),
        ).toThrow('Global functions coverage 80.00%')
        expect(() =>
            assertCoverageThresholds(
                parseCoverageReport(record('lines.ts', 10, 8, 10, 10)),
                TEST_COVERAGE_THRESHOLDS,
            ),
        ).toThrow('Global lines coverage 80.00%')
    })

    it('reads CRLF records and Windows source paths without dropping counts', function () {
        expect(
            parseCoverageReport(
                record('C:\\workspace\\src\\view.ts', 2, 2).replaceAll(
                    '\n',
                    '\r\n',
                ),
            ).files,
        ).toBe(1)
    })

    it.each([
        '',
        'SF:incomplete.ts\nLF:10',
        'LF:1\nLH:1\nFNF:1\nFNH:1\nend_of_record',
        record('empty.ts', 0, 0, 0, 0),
        record('missing.ts', 1, 1).replace('LH:1\n', ''),
        record('duplicate-field.ts', 1, 1).replace('LH:1', 'LH:1\nLH:1'),
        record('negative.ts', 1, -1),
        record('decimal.ts', 1.5, 1),
        record('unsafe.ts', Number.MAX_SAFE_INTEGER + 1, 1),
        record('over-hit.ts', 1, 2),
        record('over-functions.ts', 1, 1, 1, 2),
        record('same.ts', 1, 1) + record('same.ts', 1, 1),
        record('first.ts', Number.MAX_SAFE_INTEGER, 1) +
            record('second.ts', Number.MAX_SAFE_INTEGER, 1),
    ])(
        'fails closed for missing, incomplete, ambiguous or invalid coverage input',
        function (input) {
            expect(() => parseCoverageReport(input)).toThrow()
        },
    )

    it.each([-1, 1.1, NaN, Infinity])(
        'rejects an invalid threshold rather than silently passing',
        function (lines) {
            expect(() =>
                assertCoverageThresholds(
                    parseCoverageReport(record('valid.ts', 10, 10)),
                    { lines, functions: 0.9 },
                ),
            ).toThrow('fractions between zero and one')
        },
    )
})
