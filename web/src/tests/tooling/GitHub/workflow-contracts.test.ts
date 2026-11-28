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
        'bun --no-env-file fmt web/src contracts/v1 package.json tsconfig.json tsconfig.github.json vite.config.ts bunfig.toml .coderabbit.yaml',
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

test('CI preserves language, coverage and native contract checks and isolates PostgreSQL tests', async () => {
    const ci = await workflow('ci')
    expect(ci.permissions).toEqual({ contents: 'read' })
    const { database, ...jobs } = ci.jobs
    const commands = Object.values(jobs)
        .flatMap((job) => job.steps.map((step) => step.run ?? ''))
        .join('\n')
    for (const command of [
        'project:check',
        'run contracts:check',
        'run typecheck',
        'run lint',
        'run test',
        'run build',
        'cargo fmt',
        'cargo clippy --locked --workspace --all-targets --all-features',
        'bun --no-env-file run core:coverage',
        'cargo build --locked --release --workspace --bins',
        'run test:catalog-integration',
    ])
        expect(commands).toContain(command)
    const coverage = await read('web/src/scripts/core-tooling.ts')
    expect(coverage).toMatch(/'--fail-under-lines',\s*'90'/)
    expect(coverage).toMatch(/'--fail-under-functions',\s*'90'/)
    expect(commands).not.toMatch(
        /test:db|db:prepare|db:push|db:pull|permissions:sync|\.env(?:\s|$)/,
    )

    // Only the dedicated job migrates and tests a disposable PostgreSQL service.
    const databaseJob = z
        .object({
            services: z.object({
                postgres: z.object({
                    image: z.string(),
                    env: z.object({
                        POSTGRES_DB: z.string(),
                        POSTGRES_HOST_AUTH_METHOD: z.literal('trust'),
                    }),
                    ports: z.array(z.string()),
                }),
            }),
            env: z.object({ TEST_DATABASE_URL: z.string() }),
        })
        .parse(database)
    const { postgres } = databaseJob.services
    expect(await read('Dockerfile')).toContain(
        `FROM ${postgres.image} AS postgres-runtime`,
    )
    expect(postgres.ports).toEqual(['127.0.0.1:5432:5432'])
    const testDatabase = new URL(databaseJob.env.TEST_DATABASE_URL)
    expect(testDatabase.hostname).toBe('127.0.0.1')
    expect(testDatabase.password).toBe('')
    expect(testDatabase.pathname).toBe('/' + postgres.env.POSTGRES_DB)
    expect(postgres.env.POSTGRES_DB).toMatch(/_test$/)
    const databaseCommands = (database?.steps ?? []).map(
        (step) => step.run ?? '',
    )
    expect(
        databaseCommands.filter((command) => command.includes('db')),
    ).toEqual([
        'bun --no-env-file run test:db:prepare',
        'bun --no-env-file run test:db',
    ])
    expect(databaseCommands.join('\n')).not.toMatch(
        /db:push|db:pull|permissions:sync|\.env(?:\s|$)/,
    )
    expect(JSON.stringify(database)).not.toContain('secrets.')
    expect(ci.jobs.image?.uses).toBe('./.github/workflows/image.yml')
    const integration = await read('.github/scripts/ci/core-integration.sh')
    expect(integration).toContain('--target core-integration')
    expect(integration).toContain('--build-context integration-web=./web')
    expect(integration).toContain('docker run --rm --network none')
    expect(integration).toContain('trap ')
})

test('catalog publication builds the locked native signer before issuing credentials', async () => {
    const publication = await workflow('app-catalog-publish')
    const steps = publication.jobs.publish!.steps
    const build = steps.findIndex((step) =>
        step.run?.includes(
            'cargo build --locked --release -p marketplace-app-catalog',
        ),
    )
    const token = steps.findIndex((step) => step.id === 'distribution')
    const publish = steps.findIndex((step) =>
        step.run?.endsWith('app-catalog/run.ts publish'),
    )
    expect(build).toBeGreaterThanOrEqual(0)
    expect(token).toBeGreaterThan(build)
    expect(publish).toBeGreaterThan(token)
    expect(steps[build]?.env).toBeUndefined()
})

test('catalog metadata renewal needs neither the Marketplace nor the publication switch', async () => {
    const publication = await workflow('app-catalog-publish')
    const job = publication.jobs.publish!
    const steps = job.steps
    const token = steps.findIndex((step) => step.id === 'distribution')
    const refresh = steps.findIndex((step) =>
        step.run?.endsWith('app-catalog/run.ts refresh'),
    )
    const network = steps.findIndex((step) => step.id === 'private-network')
    const publish = steps.findIndex((step) =>
        step.run?.endsWith('app-catalog/run.ts publish'),
    )
    expect(refresh).toBeGreaterThan(token)
    expect(network).toBeGreaterThan(refresh)
    expect(publish).toBeGreaterThan(network)

    expect(Object.keys(steps[refresh]?.env ?? {}).toSorted()).toEqual([
        'APP_CATALOG_DISTRIBUTION_TOKEN',
        'APP_CATALOG_NEXT_ROOT',
        'APP_CATALOG_SNAPSHOT_KEY',
        'APP_CATALOG_TARGETS_KEY',
        'APP_CATALOG_TIMESTAMP_KEY',
        'APP_CATALOG_TRUSTED_ROOT',
    ])
    expect(steps[refresh]).not.toHaveProperty('if')
    // A job-level `if` cannot read environment variables, so it must not gate on any.
    expect(job.if).toBe(
        "github.repository == 'RentnerProxy/marketplace' && github.ref == 'refs/heads/main'",
    )
    for (const index of [network, publish])
        expect(steps[index]?.if).toBe("vars.APP_CATALOG_ENABLED == 'true'")
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
        const publicAssets = steps.findIndex(
            (step) =>
                step.run ===
                'bun --no-env-file .github/scripts/ci/public-assets.ts',
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
        expect(publicAssets).toBeGreaterThan(contracts)
        expect(steps[publicAssets]?.env?.RUNTIME_IMAGE_ID).toBe(
            '${{ steps.build.outputs.imageid }}',
        )
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
            expect(document.jobs.verify?.needs).toBe('announce')
            expect(document.jobs.announce?.needs).toBe('content')
            expect(document.jobs.announce?.permissions).toEqual({
                contents: 'write',
            })
            expect(document.jobs.announce?.steps.at(-1)?.run).toBe(
                'bun --no-env-file .github/scripts/release/publish-release.ts building',
            )
            expect(document.jobs.failed?.needs).toEqual([
                'content',
                'announce',
                'verify',
                'publish',
                'notes',
            ])
            expect(document.jobs.failed?.steps.at(-1)?.run).toBe(
                'bun --no-env-file .github/scripts/release/publish-release.ts failed',
            )
            expect(document.jobs.failed?.if).toContain('cancelled')
            const noteCommands = document.jobs.notes?.steps.map(
                (step) => step.run,
            )
            const prepared =
                noteCommands?.indexOf(
                    'bun --no-env-file .github/scripts/release/publish-release.ts prepare',
                ) ?? -1
            const uploaded =
                noteCommands?.indexOf(
                    'bash .github/scripts/release/publish-changelog.sh',
                ) ?? -1
            const completed =
                noteCommands?.indexOf(
                    'bun --no-env-file .github/scripts/release/publish-release.ts',
                ) ?? -1
            expect(prepared).toBeGreaterThan(-1)
            expect(uploaded).toBeGreaterThan(prepared)
            expect(completed).toBeGreaterThan(uploaded)
            expect(document.jobs.content?.permissions).toEqual({
                contents: 'read',
            })
            expect(document.jobs.content?.steps.at(-1)?.run).toBe(
                'bun --no-env-file .github/scripts/release/release-blog.ts',
            )
            const contentGate = steps.findIndex(
                (step) =>
                    step.name ===
                    'Revalidate release changelog before image build',
            )
            expect(contentGate).toBeGreaterThan(0)
            expect(contentGate).toBeLessThan(build)
            const publish = steps.findIndex((step) => step.id === 'publish')
            expect(publish).toBeGreaterThan(publicAssets)
            expect(steps[publish]?.env?.IMAGE_ID).toBe(
                '${{ steps.build.outputs.imageid }}',
            )
            expect(document.concurrency?.['cancel-in-progress']).toBe(false)
            expect(document.jobs.notes?.needs).toBe('publish')
            expect(document.jobs.notes?.permissions).toEqual({
                contents: 'write',
            })
        } else {
            const oci = steps.findIndex((step) =>
                step.run?.includes(
                    'bash .github/scripts/ci/verify-oci-scan.sh',
                ),
            )
            expect(oci).toBeGreaterThan(scan)
            expect(oci).toBeLessThan(lifecycle)
            expect(steps[oci]?.env?.IMAGE_ID).toBe(
                '${{ steps.build.outputs.imageid }}',
            )
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
    ).toEqual([
        'bun',
        'cargo',
        'docker',
        'docker-compose',
        'github-actions',
        'rust-toolchain',
    ])
    const bun = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'bun',
    )
    expect(bun?.directories).toEqual([
        '/',
        '/.github/scripts/ci/fixtures/app-candidate/*',
    ])
    const rustToolchain = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'rust-toolchain',
    )
    expect(rustToolchain?.directories).toEqual(['/', '/core'])
    const docker = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'docker',
    )
    expect(docker?.groups).toEqual({
        'docker-by-dependency': {
            'applies-to': 'version-updates',
            'group-by': 'dependency-name',
        },
    })
    expect(docker?.ignore).toEqual([
        {
            'dependency-name': 'postgres',
            'update-types': ['version-update:semver-major'],
        },
    ])
    const compose = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'docker-compose',
    )
    expect(await read('docker-compose.yml')).toContain(
        'ghcr.io/rentnerproxy/marketplace:v1.0.0-alpha.1',
    )
    expect(compose?.groups).toBeUndefined()
    expect(compose?.ignore).toEqual([
        { 'dependency-name': 'rentnerproxy/marketplace' },
    ])
    const actions = config.updates.find(
        (entry) => entry['package-ecosystem'] === 'github-actions',
    )
    expect(actions?.directories).toEqual(['/', '/.github/actions/*'])
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

test('image publisher resolves the validated tag through the authoritative channel mapper', async () => {
    const source = await read('.github/scripts/release/publish-image.sh')
    const mapping =
        'channel=$(bun --no-env-file .github/scripts/release/release-identity.ts)'
    expect(
        source.indexOf('bash .github/scripts/release/validate-tag.sh'),
    ).toBeLessThan(source.indexOf(mapping))
    expect(
        source.indexOf(
            'bun --no-env-file .github/scripts/release/release-blog.ts',
        ),
    ).toBeLessThan(source.indexOf(mapping))
    expect(source).toContain(mapping)
    expect(source).toContain(
        'channel_image="ghcr.io/rentnerproxy/marketplace:$channel"',
    )
    expect(source).toContain('docker tag "$IMAGE_ID" "$channel_image"')
    expect(source).not.toContain('channel=beta')
    expect(source).toContain(
        'release-identity.ts existing-image "$auth_directory/manifest.json"',
    )
    expect(source).toContain('trap ')
    expect(source).toContain('imagetools inspect "$channel_image"')
})
