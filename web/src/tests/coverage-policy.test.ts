import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEST_COVERAGE_THRESHOLDS } from '@/scripts/Coverage/coverage.config.ts'

const coverageRunner = fileURLToPath(
    new URL('../scripts/test-coverage.ts', import.meta.url),
)

const directories: string[] = []

afterEach(async function () {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
    )
})

async function runCoverageFixture(
    source: string,
    assertions: string,
    staleReport = false,
) {
    const directory = await mkdtemp(join(tmpdir(), 'coverage-policy-test-'))
    directories.push(directory)
    await Promise.all([
        writeFile(
            join(directory, 'bunfig.toml'),
            `[test]
coverageReporter = ${JSON.stringify(staleReport ? ['text'] : ['text', 'lcov'])}
coverageDir = "coverage"
`,
        ),
        writeFile(join(directory, 'subject.ts'), source),
        writeFile(
            join(directory, 'subject.test.ts'),
            `import { expect, test } from 'bun:test'
import * as subject from './subject.ts'
test('coverage fixture', () => { ${assertions} })
`,
        ),
    ])
    if (staleReport) {
        await mkdir(join(directory, 'coverage'))
        await writeFile(
            join(directory, 'coverage', 'lcov.info'),
            'SF:stale.ts\nLF:1\nLH:1\nFNF:1\nFNH:1\nend_of_record\n',
        )
    }
    const child = Bun.spawn(
        [process.execPath, '--no-env-file', 'run', coverageRunner],
        { cwd: directory, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    const reportFile = Bun.file(join(directory, 'coverage', 'lcov.info'))
    const report = (await reportFile.exists()) ? await reportFile.text() : ''
    const counts = Object.fromEntries(
        report
            .split(/\r?\n/)
            .filter((line) => /^(LF|LH|FNF|FNH):/.test(line))
            .map((line) => line.split(':')),
    )
    return {
        directory,
        exitCode,
        output: stdout + stderr,
        report,
        lines: Number(counts.LH) / Number(counts.LF),
        functions: Number(counts.FNH) / Number(counts.FNF),
    }
}

const branchingSource = `export function total(values: number[]) {
    if (values.length === 0) {
        const message = 'At least one amount is required'
        const error = new Error(message)
        error.name = 'EmptyAmountsError'
        throw error
    }
    return values.reduce((sum, amount) => sum + amount, 0)
}
`

describe('enforced coverage policy', function () {
    it('keeps both project thresholds at or above 90 percent', function () {
        expect(TEST_COVERAGE_THRESHOLDS.lines).toBeGreaterThanOrEqual(0.9)
        expect(TEST_COVERAGE_THRESHOLDS.functions).toBeGreaterThanOrEqual(0.9)
    })
    it('rejects uncovered error paths even when every function is called', async function () {
        const result = await runCoverageFixture(
            branchingSource,
            'expect(subject.total([2, 3])).toBe(5)',
        )
        expect(result.exitCode).not.toBe(0)
        expect(result.output).toContain('1 pass')
        expect(result.output).toContain('0 fail')
        expect(result.lines).toBeLessThan(TEST_COVERAGE_THRESHOLDS.lines)
        expect(result.functions).toBeGreaterThanOrEqual(
            TEST_COVERAGE_THRESHOLDS.functions,
        )
    })

    it('rejects uncalled functions even when their declarations are executed', async function () {
        const result = await runCoverageFixture(
            `export const invoiceTotal = () => 12
export const taxTotal = () => 2
export const netTotal = () => 10
`,
            'expect(subject.invoiceTotal()).toBe(12)',
        )
        expect(result.exitCode).not.toBe(0)
        expect(result.output).toContain('1 pass')
        expect(result.output).toContain('0 fail')
        expect(result.functions).toBeLessThan(
            TEST_COVERAGE_THRESHOLDS.functions,
        )
        expect(result.lines).toBeGreaterThanOrEqual(
            TEST_COVERAGE_THRESHOLDS.lines,
        )
    })

    it('accepts tested success and error paths and writes an LCOV report', async function () {
        const result = await runCoverageFixture(
            branchingSource,
            `expect(subject.total([2, 3])).toBe(5)
expect(() => subject.total([])).toThrow('At least one amount is required')`,
        )
        expect(result.exitCode).toBe(0)
        expect(result.output).toContain('1 pass')
        expect(result.report).toContain('SF:subject.ts')
        expect(result.lines).toBeGreaterThanOrEqual(
            TEST_COVERAGE_THRESHOLDS.lines,
        )
        expect(result.functions).toBeGreaterThanOrEqual(
            TEST_COVERAGE_THRESHOLDS.functions,
        )
    })

    it('propagates failing assertions even when the source is fully covered', async function () {
        const result = await runCoverageFixture(
            'export const amount = () => 12',
            'expect(subject.amount()).toBe(13)',
        )
        expect(result.exitCode).not.toBe(0)
        expect(result.output).toContain('1 fail')
        expect(result.output).not.toContain('Global coverage:')
    })

    it('rejects a missing fresh report instead of accepting stale complete coverage', async function () {
        const result = await runCoverageFixture(
            'export const amount = () => 12',
            'expect(subject.amount()).toBe(12)',
            true,
        )
        expect(result.exitCode).not.toBe(0)
        expect(result.output).toContain('1 pass')
        expect(result.report).toBe('')
        expect(result.output).not.toContain('Global coverage:')
    })
})
