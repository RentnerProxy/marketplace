import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const root = new URL('../../../../../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')
const stepSchema = z
    .object({
        name: z.string().optional(),
        id: z.string().optional(),
        uses: z.string().optional(),
        run: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        with: z.record(z.string(), z.unknown()).optional(),
        'continue-on-error': z.unknown().optional(),
    })
    .passthrough()
const workflowSchema = z
    .object({
        on: z.record(z.string(), z.unknown()),
        concurrency: z
            .object({ group: z.string(), 'cancel-in-progress': z.boolean() })
            .optional(),
        permissions: z.record(z.string(), z.string()),
        env: z.record(z.string(), z.string()).optional(),
        jobs: z.record(
            z.string(),
            z
                .object({
                    uses: z.string().optional(),
                    needs: z
                        .union([z.string(), z.array(z.string())])
                        .optional(),
                    environment: z.string().optional(),
                    permissions: z.record(z.string(), z.string()).optional(),
                    steps: z.array(stepSchema).default([]),
                    'continue-on-error': z.unknown().optional(),
                })
                .passthrough(),
        ),
    })
    .passthrough()
const workflow = async (name: string) =>
    workflowSchema.parse(
        Bun.YAML.parse(await read('.github/workflows/' + name + '.yml')),
    )

test('autofix uses the real pinned service with a narrow formatter path list and protected generated routes', async () => {
    const document = await workflow('autofix')
    expect(document.permissions).toEqual({ contents: 'read' })
    expect(document.on).toHaveProperty('pull_request')
    expect(document.on).not.toHaveProperty('pull_request_target')
    const steps = document.jobs.autofix?.steps ?? []
    const format = steps.find((step) =>
        step.run?.startsWith('bun --no-env-file fmt '),
    )
    expect(format?.run).toBe(
        'bun --no-env-file fmt web/src package.json tsconfig.json tsconfig.github.json vite.config.ts bunfig.toml .coderabbit.yaml',
    )
    expect(format?.run).not.toMatch(
        /web\/drizzle|drizzle\.config|\.env|bun\.lock|core\/Cargo\.lock|(?:^|\s)\.github(?:\/|\s|$)/,
    )
    const restore = steps.findIndex(
        (step) =>
            step.run === 'git restore --worktree -- web/src/routeTree.gen.ts',
    )
    const apply = steps.findIndex((step) =>
        step.uses?.startsWith('autofix-ci/action@'),
    )
    expect(restore).toBeGreaterThan(steps.indexOf(format!))
    expect(apply).toBeGreaterThan(restore)
    expect(steps[apply]?.uses).toMatch(/^autofix-ci\/action@[a-f0-9]{40}$/)
})

test('CI preserves language, coverage and native contract checks without prepared database actions', async () => {
    const ci = await workflow('ci')
    expect(ci.permissions).toEqual({ contents: 'read' })
    const commands = Object.values(ci.jobs)
        .flatMap((job) => job.steps.map((step) => step.run ?? ''))
        .join('\n')
    for (const command of [
        'project:check',
        'run typecheck',
        'run lint',
        'run test',
        'run build',
        'cargo fmt',
        'cargo clippy --locked --all-targets --all-features',
        '--fail-under-lines 90 --fail-under-functions 90',
        'cargo build --locked --release --bins',
    ])
        expect(commands).toContain(command)
    expect(commands).not.toMatch(
        /test:db|db:prepare|db:push|db:pull|permissions:sync|\.env(?:\s|$)/,
    )
    expect(ci.jobs.image?.uses).toBe('./.github/workflows/image.yml')
    const integration = await read('.github/scripts/ci/core-integration.sh')
    expect(integration).toContain('--target core-integration')
    expect(integration).toContain('--build-context integration-web=./web')
    expect(integration).toContain('docker run --rm --network none')
    expect(integration).toContain('trap ')
})

test.each(['image', 'release'])(
    '%s scans the exact local appliance and verifies lifecycle/contracts before publication',
    async (name) => {
        const document = await workflow(name)
        const job = document.jobs[name === 'image' ? 'image' : 'publish']
        if (!job) throw new Error('Missing appliance job')
        const steps = job.steps
        const build = steps.findIndex((step) => step.id === 'build')
        const scan = steps.findIndex((step) =>
            step.run?.startsWith('bash .github/scripts/security/scan-image.sh'),
        )
        const lifecycle = steps.findIndex(
            (step) => step.run === 'bun --no-env-file run test:deployment',
        )
        const contracts = steps.findIndex(
            (step) =>
                step.run === 'bash .github/scripts/ci/core-integration.sh',
        )
        expect(steps[build]?.with).toMatchObject({
            context: '.',
            file: './Dockerfile',
            target: 'production',
            push: false,
            load: true,
        })
        expect(scan).toBeGreaterThan(build)
        expect(lifecycle).toBeGreaterThan(scan)
        expect(contracts).toBeGreaterThan(lifecycle)
        expect(steps[scan]?.env?.IMAGE_ID).toBe(
            '${{ steps.build.outputs.imageid }}',
        )
        expect(steps[lifecycle]?.env?.RUNTIME_IMAGE_ID).toBe(
            '${{ steps.build.outputs.imageid }}',
        )
        expect(job['continue-on-error']).toBeUndefined()
        for (const step of steps) {
            expect(step['continue-on-error']).toBeUndefined()
            expect(step.with?.secrets).toBeUndefined()
        }
        if (name === 'release') {
            expect(job.environment).toBe('marketplace-release')
            expect(job.needs).toBe('verify')
            const publish = steps.findIndex((step) => step.id === 'publish')
            expect(publish).toBeGreaterThan(contracts)
            expect(steps[publish]?.env?.IMAGE_ID).toBe(
                '${{ steps.build.outputs.imageid }}',
            )
            expect(document.concurrency?.['cancel-in-progress']).toBe(false)
            expect(document.jobs.notes?.needs).toBe('publish')
            expect(document.jobs.notes?.permissions).toEqual({
                contents: 'write',
            })
        } else {
            expect(job.permissions).toEqual({ contents: 'read' })
            expect(steps.some((step) => step.id === 'publish')).toBe(false)
        }
    },
)

test('Bun and Docker toolchain pins agree and actions are maintained through Dependabot', async () => {
    const manifest = z
        .object({ packageManager: z.string() })
        .parse(JSON.parse(await read('package.json')))
    const bunVersion = manifest.packageManager.replace(/^bun@/, '')
    expect(await read('Dockerfile')).toContain('ARG BUN_VERSION=' + bunVersion)
    expect((await workflow('ci')).env?.BUN_VERSION).toBe(bunVersion)
    const config = z
        .object({
            updates: z.array(
                z
                    .object({
                        'package-ecosystem': z.string(),
                        cooldown: z.object({ 'default-days': z.number() }),
                        schedule: z.object({
                            interval: z.string(),
                            cronjob: z.string(),
                            timezone: z.string(),
                        }),
                    })
                    .passthrough(),
            ),
        })
        .parse(Bun.YAML.parse(await read('.github/dependabot.yml')))
    expect(
        config.updates.map((entry) => entry['package-ecosystem']).toSorted(),
    ).toEqual(['bun', 'cargo', 'docker', 'docker-compose', 'github-actions'])
    const docker = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'docker',
    )
    expect(docker?.groups).toEqual({
        'docker-by-dependency': {
            'applies-to': 'version-updates',
            'group-by': 'dependency-name',
        },
    })
    const compose = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'docker-compose',
    )
    expect(await read('docker-compose.yml')).toContain(
        'ghcr.io/rentnerproxy/marketplace:latest',
    )
    expect(compose?.groups).toBeUndefined()
    expect(compose?.ignore).toEqual([
        { 'dependency-name': 'rentnerproxy/marketplace' },
    ])
    const actions = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'github-actions',
    )
    expect(actions?.groups).toEqual({
        'github-actions-minor-and-patch': {
            'applies-to': 'version-updates',
            patterns: ['*'],
            'update-types': ['minor', 'patch'],
        },
    })
    for (const entry of config.updates) {
        expect(entry.cooldown['default-days']).toBe(1)
        expect(entry.schedule).toEqual({
            interval: 'cron',
            cronjob: '0 3 * * *',
            timezone: 'Europe/Berlin',
        })
    }
})
