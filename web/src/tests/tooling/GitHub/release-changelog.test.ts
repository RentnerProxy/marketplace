import { expect, test } from 'bun:test'
import {
    chmod,
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test
    .skipIf(process.platform === 'win32')
    .each(['new', 'identical', 'different'])(
    'changelog publication handles %s assets without deleting published content',
    async (scenario) => {
        const directory = await mkdtemp(
            join(tmpdir(), 'marketplace-release-changelog-'),
        )
        try {
            const scripts = join(directory, '.github/scripts/release')
            const bin = join(directory, 'bin')
            await Promise.all([mkdir(scripts, { recursive: true }), mkdir(bin)])
            await copyFile(
                new URL(
                    '../../../../../.github/scripts/release/publish-changelog.sh',
                    import.meta.url,
                ),
                join(scripts, 'publish-changelog.sh'),
            )
            await writeFile(
                join(scripts, 'validate-tag.sh'),
                '#!/usr/bin/env bash\nexit 0\n',
            )
            const name = 'Marketplace-v1.0.0-alpha.1-CHANGELOG.md'
            await writeFile(join(directory, name), 'Prepared changelog\n')
            await writeFile(
                join(bin, 'gh'),
                `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
if [[ "$1" == api ]]; then
    if [[ "$SCENARIO" != new ]]; then printf '%s\\n' 'Marketplace-v1.0.0-alpha.1-CHANGELOG.md'; fi
elif [[ "$2" == download ]]; then
    for argument in "$@"; do output_path="$argument"; done
    if [[ "$SCENARIO" == identical ]]; then printf 'Prepared changelog\\n' > "$output_path"
    else printf 'Published changelog\\n' > "$output_path"; fi
elif [[ "$2" != upload ]]; then exit 99
fi
`,
            )
            await chmod(join(bin, 'gh'), 0o755)
            const child = Bun.spawn(
                ['bash', '.github/scripts/release/publish-changelog.sh'],
                {
                    cwd: directory,
                    env: {
                        ...process.env,
                        RUNNER_TEMP: directory,
                        RELEASE_TAG: 'v1.0.0-alpha.1',
                        GITHUB_REPOSITORY: 'RentnerProxy/marketplace',
                        SCENARIO: scenario,
                        PATH: bin + ':' + process.env.PATH,
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [code, _output, errors] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            expect(code).toBe(scenario === 'different' ? 1 : 0)
            const calls = await readFile(join(directory, 'calls'), 'utf8')
            expect(calls.includes('release upload')).toBe(scenario === 'new')
            expect(calls).not.toContain('--clobber')
            expect(calls).not.toContain('DELETE')
            if (scenario === 'different')
                expect(errors).toContain('refusing to overwrite')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)
