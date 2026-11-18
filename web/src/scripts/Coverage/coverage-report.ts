import { runNativeTool, runNativeToolSync } from '../../lib/Core/native-tool.ts'
import type {
    CoverageSummary,
    CoverageThresholds,
} from './Types/coverage.types.ts'

export function parseCoverageReport(report: string): CoverageSummary {
    return runNativeToolSync('marketplace-tooling', 'coverage-parse', {
        report,
    })
}

export function assertCoverageThresholds(
    summary: CoverageSummary,
    thresholds: CoverageThresholds,
): CoverageThresholds {
    return runNativeToolSync('marketplace-tooling', 'coverage-check', {
        summary,
        thresholds,
    })
}

export function verifyCoverageFile(
    path: string,
    thresholds: CoverageThresholds,
) {
    return runNativeTool<{
        summary: CoverageSummary
        percentages: CoverageThresholds
    }>('marketplace-tooling', 'coverage-file', { path, thresholds })
}
