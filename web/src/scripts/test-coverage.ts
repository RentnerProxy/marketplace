import { unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { TEST_COVERAGE_THRESHOLDS } from './Coverage/coverage.config.ts'
import {
    assertCoverageThresholds,
    parseCoverageReport,
} from './Coverage/coverage-report.ts'

async function main() {
    const root = process.cwd()
    const config = z
        .object({
            test: z.object({ coverageDir: z.string().min(1) }),
        })
        .parse(Bun.TOML.parse(await Bun.file(join(root, 'bunfig.toml')).text()))
    const report = resolve(root, config.test.coverageDir, 'lcov.info')
    const relativeReport = relative(root, report)
    if (
        isAbsolute(relativeReport) ||
        relativeReport === '..' ||
        relativeReport.startsWith('..' + sep)
    ) {
        throw new Error('Coverage output must stay within the test workspace.')
    }
    await unlink(report).catch((error: unknown) => {
        if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
        ))
            throw error
    })
    const child = Bun.spawn({
        cmd: [
            process.execPath,
            '--no-env-file',
            'test',
            '--isolate',
            '--coverage',
            ...process.argv.slice(2),
        ],
        cwd: root,
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
        windowsHide: true,
    })
    const exitCode = await child.exited
    if (exitCode !== 0) {
        process.exitCode = exitCode
        return
    }
    const summary = parseCoverageReport(await Bun.file(report).text())
    const percentages = assertCoverageThresholds(
        summary,
        TEST_COVERAGE_THRESHOLDS,
    )
    console.log(
        `Global coverage: ${(percentages.lines * 100).toFixed(2)}% lines, ${(percentages.functions * 100).toFixed(2)}% functions (${summary.files} source files; minimum ${TEST_COVERAGE_THRESHOLDS.lines * 100}% lines / ${TEST_COVERAGE_THRESHOLDS.functions * 100}% functions).`,
    )
}

await main().catch((error: unknown) => {
    console.error(
        error instanceof Error
            ? error.message
            : 'Coverage verification failed.',
    )
    process.exitCode = 1
})
