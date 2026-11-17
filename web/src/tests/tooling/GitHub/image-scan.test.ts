import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assertPatchedImagePackage } from '../../../../../.github/scripts/security/verify-image-picomatch.ts'

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
const imageId = 'sha256:' + 'a'.repeat(64)
function shellPath(path: string) {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(
              /^([a-z]):/i,
              (_, drive: string) => '/' + drive.toLowerCase(),
          )
        : normalized
}

async function executeScan(status: number, archive: boolean, proofStatus = 1) {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-image-scan-'))
    try {
        await mkdir(join(directory, 'layout'))
        await Promise.all([
            writeFile(
                join(directory, 'trivy'),
                '#!/bin/sh\nset -eu\n[ "${GITHUB_TOKEN+x}" != x ] || exit 91\n[ "${GH_TOKEN+x}" != x ] || exit 92\nprintf "%s\\n" "$@"\nexit "$SYNTHETIC_STATUS"\n',
                { mode: 0o700 },
            ),
            writeFile(
                join(directory, 'bun'),
                '#!/bin/sh\nexit "$SYNTHETIC_PROOF_STATUS"\n',
                { mode: 0o700 },
            ),
            writeFile(join(directory, 'layout', 'index.json'), '{}'),
        ])
        const script = join(directory, 'scan.sh')
        await writeFile(script, 'export PATH="$SYNTHETIC_PATH"\n' + source)
        const result = spawnSync(
            shell,
            [
                '--noprofile',
                '--norc',
                shellPath(script),
                archive ? 'layout' : imageId,
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
                    SYNTHETIC_PROOF_STATUS: String(proofStatus),
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

shellTest.each([
    [0, false],
    [23, false],
    [0, true],
    [23, true],
] as const)(
    'anonymous image scan preserves scanner exit %s (archive: %s)',
    async (status, archive) => {
        const result = await executeScan(status, archive)
        expect(result.code).toBe(status)
        expect(result.stderr).toBe('')
        expect(result.args[0]).toBe('image')
        expect(result.args.includes('--input')).toBe(archive)
        expect(result.args.at(-1)).toBe(archive ? 'layout' : imageId)
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
        expect(result.args).not.toContain('--ignore-policy')
    },
)

shellTest.each([false, true])(
    'verified patch keeps the original scan failure (OCI layout: %s)',
    async (archive) => {
        const result = await executeScan(23, archive, 0)
        expect(result.code).toBe(23)
        expect(result.stderr).toContain(
            'Verified the installed picomatch patch',
        )
        const policy = result.args.indexOf('--ignore-policy')
        expect(policy).toBeGreaterThan(0)
        expect(result.args[policy + 1]).toEndWith('/picomatch-image.rego')
        expect(result.args.at(-1)).toBe(archive ? 'layout:scan' : imageId)
        expect(result.args.slice(-3)).toContain(archive ? '--input' : 'docker')
    },
)

test('image proof requires the exact installed picomatch version and parser', async () => {
    const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'marketplace-image-patch-')),
    )
    try {
        const installed = new URL(
            '../../../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/',
            import.meta.url,
        )
        const manifest = join(directory, 'package.json')
        const parser = join(directory, 'lib', 'parse.js')
        await mkdir(join(directory, 'lib'))
        await Promise.all([
            copyFile(new URL('package.json', installed), manifest),
            copyFile(new URL('lib/parse.js', installed), parser),
        ])
        await assertPatchedImagePackage(directory)
        await writeFile(parser, 'unexpected parser bytes')
        await expect(assertPatchedImagePackage(directory)).rejects.toThrow(
            'parser digest',
        )
        await writeFile(
            manifest,
            JSON.stringify({ name: 'picomatch', version: '4.0.6' }),
        )
        await expect(assertPatchedImagePackage(directory)).rejects.toThrow(
            'picomatch identity',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
