import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
const bootstrapBase = '96b976cd7f3fa606c19678d7f9f02eac0506a110'
const shell =
    process.platform === 'win32'
        ? 'C:/Program Files/Git/bin/bash.exe'
        : '/bin/bash'
const shellTest = test.skipIf(!existsSync(shell))
const workflow = z
    .object({
        permissions: z.record(z.string(), z.string()),
        jobs: z.object({
            gitleaks: z.object({
                steps: z.array(
                    z
                        .object({
                            name: z.string().optional(),
                            run: z.string().optional(),
                            env: z.record(z.string(), z.string()).optional(),
                        })
                        .passthrough(),
                ),
            }),
        }),
    })
    .parse(
        Bun.YAML.parse(
            await readFile(
                join(repository, '.github/workflows/gitleaks.yml'),
                'utf8',
            ),
        ),
    )
function requiredScript(name: string): string {
    const script = workflow.jobs.gitleaks.steps.find(
        (step) => step.name === name,
    )?.run
    if (!script) throw new Error('Missing self-contained scanner step')
    return script
}
const policy = requiredScript('Select verified scanner policy')
const scan = requiredScript('Scan commits')

async function git(directory: string, ...args: string[]) {
    const child = Bun.spawn(
        ['git', '-c', 'core.hooksPath=/dev/null', '-C', directory, ...args],
        { stdout: 'pipe', stderr: 'pipe', windowsHide: true },
    )
    const [status, output] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    if (status) throw new Error('Synthetic scanner Git fixture failed')
    return output.trim()
}

async function fixture(
    operation: (state: {
        directory: string
        temporary: string
        head: string
        base: string
        run: (overrides?: Record<string, string>) => Promise<number>
    }) => Promise<void>,
) {
    const directory = await mkdtemp(
        join(tmpdir(), 'marketplace-scanner-policy-'),
    )
    try {
        const trusted = join(directory, 'trusted')
        const temporary = join(directory, 'temp')
        await mkdir(trusted)
        await mkdir(temporary)
        await git(directory, 'init', '--quiet')
        await writeFile(
            join(directory, 'README.md'),
            'Synthetic initial import base\n',
        )
        await git(directory, 'add', 'README.md')
        await git(
            directory,
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '--quiet',
            '-m',
            'initial README',
        )
        const base = await git(directory, 'rev-parse', 'HEAD')
        await writeFile(
            join(directory, '.gitleaks.toml'),
            (await git(repository, 'show', 'HEAD:.gitleaks.toml')) + '\n',
        )
        await git(directory, 'add', '.gitleaks.toml')
        await git(
            directory,
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '--quiet',
            '-m',
            'reviewed policy',
        )
        const head = await git(directory, 'rev-parse', 'HEAD')
        await git(trusted, 'init', '--quiet')
        await git(trusted, 'fetch', '--quiet', directory, head, base)
        await git(trusted, 'update-ref', 'HEAD', base)
        const script = join(directory, 'policy.sh')
        // Substitute only the immutable anchor in a tiny local Git history; the
        // production anchor and reviewed policy hash are asserted separately.
        await writeFile(script, policy.replace(bootstrapBase, base))
        const run = async (overrides: Record<string, string> = {}) => {
            const child = Bun.spawn(
                [shell, '--noprofile', '--norc', script.replaceAll('\\', '/')],
                {
                    cwd: directory,
                    env: {
                        ...process.env,
                        RUNNER_TEMP: temporary.replaceAll('\\', '/'),
                        EVENT_NAME: 'pull_request',
                        SOURCE_REPOSITORY: 'RentnerProxy/marketplace',
                        TRUSTED_SHA: base,
                        PR_HEAD_SHA: head,
                        ...overrides,
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                    windowsHide: true,
                },
            )
            const [status] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            return status
        }
        await operation({ directory, temporary, head, base, run })
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

test('scanner remains read-only and never executes PR or trusted-base helper scripts', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(policy).toContain(bootstrapBase)
    expect(policy).toContain(
        '4f94464674e89d9981ca773fc8af778f461fd76d5438aca6cc6742a9ee370bf7',
    )
    for (const step of workflow.jobs.gitleaks.steps) {
        expect(step.run ?? '').not.toMatch(/bash (?:trusted\/)?\.github\//)
        expect(step.run ?? '').not.toContain('|| true')
    }
    expect(scan).toContain('--gitleaks-ignore-path=/dev/null --redact=100')
    expect(scan).toContain('--config="$RUNNER_TEMP/gitleaks-verified.toml"')
    const install =
        workflow.jobs.gitleaks.steps.find(
            (step) => step.name === 'Install checksum-verified Gitleaks',
        )?.run ?? ''
    expect(install.indexOf('sha256sum --check --strict')).toBeLessThan(
        install.indexOf('tar -xzf'),
    )
})

shellTest(
    'initial README-only base accepts only the reviewed hash-pinned exact head policy',
    async () => {
        await fixture(async ({ directory, temporary, head, run }) => {
            await writeFile(
                join(directory, '.gitleaks.toml'),
                'untrusted working-tree policy must not be read',
            )
            expect(await run()).toBe(0)
            expect(
                await readFile(
                    join(temporary, 'gitleaks-verified.toml'),
                    'utf8',
                ),
            ).toBe(
                (await git(directory, 'show', head + ':.gitleaks.toml')) + '\n',
            )
        })
    },
)

shellTest(
    'normal operation loads trusted-base policy instead of the PR working tree',
    async () => {
        await fixture(async ({ directory, temporary, head, run }) => {
            await git(join(directory, 'trusted'), 'update-ref', 'HEAD', head)
            await writeFile(
                join(directory, '.gitleaks.toml'),
                'unverified PR policy',
            )
            expect(await run({ TRUSTED_SHA: head })).toBe(0)
            expect(
                await readFile(
                    join(temporary, 'gitleaks-verified.toml'),
                    'utf8',
                ),
            ).toBe(
                (await git(directory, 'show', head + ':.gitleaks.toml')) + '\n',
            )
        })
    },
)

shellTest(
    'bootstrap rejects changed policy content even at the allowed initial base',
    async () => {
        await fixture(async ({ directory, run }) => {
            await writeFile(
                join(directory, '.gitleaks.toml'),
                '[extend]\nuseDefault = true\n',
            )
            await git(directory, 'add', '.gitleaks.toml')
            const tree = await git(directory, 'write-tree')
            const changed = await git(
                directory,
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.test',
                'commit-tree',
                tree,
                '-m',
                'changed policy',
            )
            expect(await run({ PR_HEAD_SHA: changed })).not.toBe(0)
        })
    },
)

shellTest(
    'a future missing trusted policy fails closed instead of reusing bootstrap',
    async () => {
        await fixture(async ({ directory, base, run }) => {
            const trusted = join(directory, 'trusted')
            const tree = await git(trusted, 'rev-parse', base + '^{tree}')
            const future = await git(
                trusted,
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.test',
                'commit-tree',
                tree,
                '-p',
                base,
                '-m',
                'future missing policy',
            )
            await git(trusted, 'update-ref', 'HEAD', future)
            expect(await run({ TRUSTED_SHA: future })).not.toBe(0)
        })
    },
)

shellTest(
    'bootstrap is unavailable for other repositories/events or mismatched trusted checkout',
    async () => {
        await fixture(async ({ head, run }) => {
            expect(
                await run({ SOURCE_REPOSITORY: 'someone/marketplace' }),
            ).not.toBe(0)
            expect(await run({ EVENT_NAME: 'push' })).not.toBe(0)
            expect(await run({ TRUSTED_SHA: head })).not.toBe(0)
            expect(await run({ PR_HEAD_SHA: 'not-a-commit' })).not.toBe(0)
        })
    },
)
