import type {
    CoverageSummary,
    CoverageThresholds,
} from './Types/coverage.types.ts'

export function parseCoverageReport(report: string): CoverageSummary {
    if (!report.trim().endsWith('end_of_record')) {
        throw new Error('Missing or incomplete LCOV report.')
    }
    const summary: CoverageSummary = {
        files: 0,
        lines: { found: 0, hit: 0 },
        functions: { found: 0, hit: 0 },
    }
    const sources = new Set<string>()
    for (const block of report.split('end_of_record')) {
        if (!block.trim()) continue
        const fields = new Map<string, string>()
        for (const line of block.trim().split(/\r?\n/)) {
            const separator = line.indexOf(':')
            const key = line.slice(0, separator)
            if (!['SF', 'LF', 'LH', 'FNF', 'FNH'].includes(key)) continue
            if (fields.has(key))
                throw new Error('Duplicate LCOV summary field.')
            fields.set(key, line.slice(separator + 1))
        }
        const source = fields.get('SF')
        if (!source || sources.has(source)) {
            throw new Error('Missing or duplicate LCOV source record.')
        }
        sources.add(source)
        const counts = ['LF', 'LH', 'FNF', 'FNH'].map((key) => {
            const value = fields.get(key)
            if (!value || !/^\d+$/.test(value)) {
                throw new Error('Missing or invalid LCOV coverage counts.')
            }
            const count = Number(value)
            if (!Number.isSafeInteger(count)) {
                throw new Error('LCOV coverage counts exceed safe integers.')
            }
            return count
        })
        const [lines, linesHit, functions, functionsHit] = counts
        if (linesHit > lines || functionsHit > functions) {
            throw new Error('LCOV covered counts exceed measured totals.')
        }
        summary.files++
        summary.lines.found += lines
        summary.lines.hit += linesHit
        summary.functions.found += functions
        summary.functions.hit += functionsHit
    }
    if (
        summary.files === 0 ||
        summary.lines.found === 0 ||
        summary.functions.found === 0
    ) {
        throw new Error(
            'Coverage report has no measured source lines or functions.',
        )
    }
    if (
        !Object.values(summary.lines)
            .concat(Object.values(summary.functions))
            .every(Number.isSafeInteger)
    ) {
        throw new Error('LCOV coverage totals exceed safe integers.')
    }
    return summary
}

export function assertCoverageThresholds(
    summary: CoverageSummary,
    thresholds: CoverageThresholds,
) {
    const metrics = ['lines', 'functions'] as const
    for (const metric of metrics) {
        if (
            !Number.isFinite(thresholds[metric]) ||
            thresholds[metric] < 0 ||
            thresholds[metric] > 1
        ) {
            throw new Error(
                'Coverage thresholds must be fractions between zero and one.',
            )
        }
    }
    const percentages = {
        lines: summary.lines.hit / summary.lines.found,
        functions: summary.functions.hit / summary.functions.found,
    }
    const failures = metrics.filter(
        (metric) => percentages[metric] < thresholds[metric],
    )
    if (failures.length) {
        throw new Error(
            failures
                .map(
                    (metric) =>
                        `Global ${metric} coverage ${(percentages[metric] * 100).toFixed(2)}% is below ${(thresholds[metric] * 100).toFixed(2)}%.`,
                )
                .join(' '),
        )
    }
    return percentages
}
