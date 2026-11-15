export type CoverageMetric = {
    found: number
    hit: number
}

export type CoverageSummary = {
    files: number
    lines: CoverageMetric
    functions: CoverageMetric
}

export type CoverageThresholds = {
    lines: number
    functions: number
}
