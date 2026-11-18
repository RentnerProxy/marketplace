import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeToolPath } from '../../../lib/Core/native-tool.ts'

const validator = fileURLToPath(
    new URL(
        '../../../../../.github/scripts/deploy/dev-image.ts',
        import.meta.url,
    ),
)

const source = await readFile(
    new URL(
        '../../../../../.github/scripts/deploy/scan-dev-image.sh',
        import.meta.url,
    ),
    'utf8',
)
const shell =
    process.platform === 'win32'
        ? 'C:/Program Files/Git/bin/bash.exe'
        : '/bin/bash'
const shellTest = test.skipIf(!existsSync(shell))

function shellPath(path: string) {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(
              /^([a-z]):/i,
              (_, drive: string) => '/' + drive.toLowerCase(),
          )
        : normalized
}

async function executeScan(
    options: {
        sha?: string
        mutate?: boolean
        mismatch?: boolean
        status?: number
    } = {},
) {
    const directory = await mkdtemp(
        join(tmpdir(), 'marketplace-dev-scan-test-'),
    )
    if (
        resolve(dirname(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('marketplace-dev-scan-test-')
    )
        throw new Error('Unexpected fixture cleanup path')
    try {
        const runner = join(directory, 'runner')
        const candidate = join(directory, 'candidate')
        const security = join(directory, '.github/scripts/security')
        await Promise.all([
            mkdir(runner),
            mkdir(candidate),
            mkdir(security, { recursive: true }),
        ])
        const archive = 'sealed synthetic OCI archive\n'
        await writeFile(join(candidate, 'candidate-image.tar'), archive)
        await writeFile(join(runner, 'unrelated-sentinel'), 'preserve me')
        const calls = join(directory, 'calls')
        await writeFile(calls, '')
        await writeFile(
            join(directory, 'bun'),
            '#!/bin/sh\nshift 2\nexec "$SYNTHETIC_BUN" --no-env-file "$SYNTHETIC_VALIDATOR" "$@"\n',
            { mode: 0o700 },
        )
        await writeFile(
            join(directory, 'skopeo'),
            `#!/bin/sh
set -eu
printf 'skopeo' >> "$SYNTHETIC_CALLS"
printf ' %s' "$@" >> "$SYNTHETIC_CALLS"
printf '\\n' >> "$SYNTHETIC_CALLS"
operation="$1"
shift
if [ "$operation" = copy ]; then
    source=''
    target=''
    for arg in "$@"; do
        case "$arg" in
            oci-archive:*) source="\${arg#oci-archive:}" ;;
            oci:*) target="\${arg#oci:}"; target="\${target%:scan}" ;;
        esac
    done
    [ -n "$source" ] && [ -n "$target" ]
    mkdir -p "$target"
    printf '{}' > "$target/index.json"
    [ "$SYNTHETIC_MUTATE" != 1 ] || printf 'mutated' >> "$source"
    exit 0
fi
if [ "$operation" = inspect ]; then
    for arg in "$@"; do
        case "$arg" in
            oci:*)
                if [ "$SYNTHETIC_MISMATCH" = 1 ]; then
                    printf '{"manifest":"changed"}'
                    exit 0
                fi ;;
        esac
    done
    printf '{"manifest":"sealed"}'
    exit 0
fi
exit 90
`,
            { mode: 0o700 },
        )
        await writeFile(
            join(security, 'scan-image.sh'),
            `#!/bin/sh
set -eu
[ "$#" = 2 ] && [ "$2" = --input ] && [ -f "$1/index.json" ] || exit 91
printf 'scanner %s %s\\n' "$1" "$2" >> "$SYNTHETIC_CALLS"
exit "$SYNTHETIC_STATUS"
`,
        )
        const script = join(directory, 'run-scan.sh')
        await writeFile(script, 'export PATH="$SYNTHETIC_PATH"\n' + source)
        const result = spawnSync(
            shell,
            ['--noprofile', '--norc', shellPath(script)],
            {
                cwd: directory,
                env: {
                    SystemRoot: process.env.SystemRoot,
                    MARKETPLACE_TOOLING_BIN: nativeToolPath(
                        'marketplace-tooling',
                    ),
                    SYNTHETIC_BUN: shellPath(process.execPath),
                    SYNTHETIC_VALIDATOR: shellPath(validator),
                    SYNTHETIC_PATH:
                        shellPath(directory) +
                        ':' +
                        (process.platform === 'win32'
                            ? shellPath(join(dirname(shell), '../usr/bin'))
                            : '/usr/bin:/bin'),
                    SYNTHETIC_CALLS: shellPath(calls),
                    SYNTHETIC_MUTATE: options.mutate ? '1' : '0',
                    SYNTHETIC_MISMATCH: options.mismatch ? '1' : '0',
                    SYNTHETIC_STATUS: String(options.status ?? 0),
                    CANDIDATE_DIRECTORY: shellPath(candidate),
                    SCAN_ARCHIVE_SHA256:
                        options.sha ??
                        createHash('sha256').update(archive).digest('hex'),
                    RUNNER_TEMP: shellPath(runner),
                },
                encoding: 'utf8',
                timeout: 5000,
                windowsHide: true,
            },
        )
        if (result.error) throw result.error
        return {
            code: result.status,
            calls: (await readFile(calls, 'utf8'))
                .trim()
                .split(/\r?\n/)
                .filter(Boolean),
            remaining: await readdir(runner),
            stderr: result.stderr,
        }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

shellTest.each(['f'.repeat(64), 'invalid', `${'a'.repeat(64)}\n`])(
    'rejects an incorrect or malformed archive SHA before tools run: %j',
    async (sha) => {
        const result = await executeScan({ sha })
        expect(result.code).not.toBe(0)
        expect(result.stderr).toMatch(
            /Invalid scan archive hash|Scan archive hash mismatch/,
        )
        expect(result.calls).toEqual([])
        expect(result.remaining).toEqual(['unrelated-sentinel'])
    },
)

shellTest.each([{ mutate: true }, { mismatch: true }])(
    'rejects source mutation or manifest mismatch before scanning: %j',
    async (options) => {
        const result = await executeScan(options)
        expect(result.code).not.toBe(0)
        expect(
            result.calls.some((call) => call.startsWith('skopeo copy ')),
        ).toBe(true)
        expect(result.calls.some((call) => call.startsWith('scanner '))).toBe(
            false,
        )
        expect(result.remaining).toEqual(['unrelated-sentinel'])
    },
)

shellTest.each([0, 23])(
    'scans preserved OCI layout and propagates scanner exit %s',
    async (status) => {
        const result = await executeScan({ status })
        expect(result.stderr).toBe('')
        expect(result.code).toBe(status)
        const copy = result.calls.find((call) =>
            call.startsWith('skopeo copy '),
        )
        expect(copy).toContain('--all')
        expect(copy).toContain('--preserve-digests')
        expect(copy).toContain('oci-archive:')
        expect(copy).toContain('oci:')
        const scanner = result.calls.filter((call) =>
            call.startsWith('scanner '),
        )
        expect(scanner).toHaveLength(1)
        expect(scanner[0]).toMatch(
            /marketplace-dev-scan\.[^/]+\/layout --input$/,
        )
        expect(result.remaining).toEqual(['unrelated-sentinel'])
    },
)
