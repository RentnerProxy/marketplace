import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const source = await readFile(
    new URL(
        '../../../../../.github/scripts/security/scan-image.sh',
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

async function executeScan(status: number, archive: boolean) {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-image-scan-'))
    try {
        await writeFile(
            join(directory, 'trivy'),
            '#!/bin/sh\nset -eu\n[ "${GITHUB_TOKEN+x}" != x ] || exit 91\n[ "${GH_TOKEN+x}" != x ] || exit 92\nprintf "%s\\n" "$@"\nexit "$SYNTHETIC_STATUS"\n',
            { mode: 0o700 },
        )
        const script = join(directory, 'scan.sh')
        await writeFile(script, 'export PATH="$SYNTHETIC_PATH"\n' + source)
        const result = spawnSync(
            shell,
            [
                '--noprofile',
                '--norc',
                shellPath(script),
                'sha256:' + 'a'.repeat(64),
                ...(archive ? ['--input'] : []),
            ],
            {
                cwd: directory,
                env: {
                    SYNTHETIC_PATH:
                        shellPath(directory) +
                        ':' +
                        (process.platform === 'win32'
                            ? shellPath(join(dirname(shell), '../usr/bin'))
                            : '/usr/bin:/bin'),
                    SYNTHETIC_STATUS: String(status),
                    GITHUB_TOKEN: 'synthetic-ci-token',
                    GH_TOKEN: 'synthetic-ci-token',
                },
                encoding: 'utf8',
                timeout: 5000,
                windowsHide: true,
            },
        )
        if (result.error) throw result.error
        return {
            code: result.status,
            args: result.stdout.trim().split(/\r?\n/),
            stderr: result.stderr,
        }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

shellTest.each([[0, false], [23, false], [0, true], [23, true]] as const)(
    'anonymous image scan preserves scanner exit %s (archive: %s)',
    async (status, archive) => {
        const result = await executeScan(status, archive)
        expect(result.code).toBe(status)
        expect(result.stderr).toBe('')
        expect(result.args[0]).toBe('image')
        expect(result.args.includes('--input')).toBe(archive)
        expect(result.args.at(-1)).toBe('sha256:' + 'a'.repeat(64))
        for (const [flag, value] of [
            ['--scanners', 'vuln'],
            ['--pkg-types', 'os,library'],
            ['--severity', 'HIGH,CRITICAL'],
            ['--exit-code', '1'],
        ])
            expect(result.args[result.args.indexOf(flag ?? '') + 1]).toBe(value)
        expect(
            result.args.flatMap((argument, index) =>
                argument === '--db-repository' ? [result.args[index + 1]] : [],
            ),
        ).toEqual([
            'public.ecr.aws/aquasecurity/trivy-db:2',
            'mirror.gcr.io/aquasec/trivy-db:2',
            'ghcr.io/aquasecurity/trivy-db:2',
        ])
        expect(result.args).not.toContain('--skip-db-update')
        expect(result.args).not.toContain('--ignore-unfixed')
    },
)
