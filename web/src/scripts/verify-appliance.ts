/* eslint-disable no-await-in-loop -- Owned disposable resources are exercised and cleaned up in lifecycle order. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createLocalRuntimeImageReferenceService } from './Deployment/runtime-image-reference.service.ts'

const nonce = randomUUID()
const prefix = 'rentnerproxy-marketplace-appliance-' + nonce
const directory = await mkdtemp(join(tmpdir(), prefix + '-'))
const containers = new Set<string>()
const images = new Set<string>()
let runtimeImage:
    | Awaited<ReturnType<typeof createLocalRuntimeImageReferenceService>>
    | undefined
const volume = prefix + '-data'
const password = 'synthetic $ ; " ä ' + nonce
const environment = {
    ...process.env,
    POSTGRES_PASSWORD: password,
    POSTGRES_USER: 'postgres',
    ORIGIN: 'https://example.test',
    AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'mail@example.test',
    SMTP_PASSWORD: 'synthetic-mail',
    MAIL_FROM: 'mail@example.test',
}

async function docker(args: string[], allowFailure = false) {
    const child = Bun.spawn(['docker', ...args], {
        env: environment,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true,
    })
    const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    if (code !== 0 && !allowFailure)
        throw new Error(
            'Isolated Docker check failed: ' +
                args[0] +
                '\n' +
                stderr.replaceAll(password, '[REDACTED]'),
        )
    return { code, stdout, stderr }
}
function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}
async function health(name: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
        const state = await docker([
            'inspect',
            '--format',
            '{{.State.Running}} {{.State.Health.Status}}',
            name,
        ])
        if (state.stdout.trim() === 'true healthy') return
        assert(
            state.stdout.startsWith('true'),
            'Isolated appliance stopped during startup.',
        )
        await Bun.sleep(500)
    }
    throw new Error('Isolated appliance readiness timed out.')
}
async function start(image: string, name: string, command: string[] = []) {
    containers.add(name)
    await docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        'rentnerproxy-marketplace.test=' + nonce,
        '--init',
        '--network',
        'none',
        '--mount',
        'type=volume,source=' + volume + ',target=/data',
        ...[
            'POSTGRES_PASSWORD',
            'POSTGRES_USER',
            'ORIGIN',
            'AUTH_ENCRYPTION_KEY',
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
            'SMTP_PASSWORD',
            'MAIL_FROM',
        ].flatMap((key) => ['-e', key]),
        image,
        ...command,
    ])
    await health(name)
}

try {
    const base = process.env.RUNTIME_IMAGE_ID ?? prefix + ':runtime'
    assert(
        /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*)$/.test(base),
        'Invalid isolated runtime image identity.',
    )
    if (!process.env.RUNTIME_IMAGE_ID) {
        images.add(base)
        await docker([
            'build',
            '--label',
            'rentnerproxy-marketplace.test=' + nonce,
            '--build-arg',
            'APP_VERSION=deployment-test',
            '-t',
            base,
            '.',
        ])
    }
    runtimeImage = await createLocalRuntimeImageReferenceService({
        source: base,
        tag: prefix + ':base',
        docker,
    })
    await writeFile(join(directory, '.env'), '')
    await writeFile(
        join(directory, 'compose.yml'),
        await readFile(
            new URL('../../../docker-compose.yml', import.meta.url),
            'utf8',
        ),
    )
    await docker([
        'compose',
        '--env-file',
        join(directory, '.env'),
        '-f',
        join(directory, 'compose.yml'),
        'config',
        '--quiet',
    ])
    const runtime = await readFile(
        new URL(
            '../tests/Deployment/Fixtures/appliance-runtime.fixture.ts',
            import.meta.url,
        ),
        'utf8',
    )
    await writeFile(join(directory, 'runtime.ts'), runtime)
    await writeFile(
        join(directory, 'worker-health.ts'),
        "const time = Number(await Bun.file('/data/storage/fixture-worker-heartbeat').text()); process.exit(Date.now() - time < 5000 ? 0 : 1)\n",
    )
    await writeFile(
        join(directory, 'Dockerfile'),
        [
            'FROM ' + runtimeImage.reference,
            'USER root',
            'ENTRYPOINT ["tini", "--", "container-entrypoint.sh"]',
            'CMD ["start"]',
            'ENV POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 POSTGRES_DB=rentnerproxy_marketplace NODE_ENV=production',
            'COPY runtime.ts /app/web/src/server/productionEntrypoint.ts',
            'COPY runtime.ts /app/web/src/server/productionWorkerEntrypoint.ts',
            'COPY worker-health.ts /app/web/src/server/workerHealthcheck.ts',
            'HEALTHCHECK --interval=1s --timeout=15s --start-period=1s --retries=30 CMD ["container-healthcheck.sh"]',
        ].join('\n') + '\n',
    )
    const image = prefix + ':fixture'
    images.add(image)
    await docker([
        'build',
        '--label',
        'rentnerproxy-marketplace.test=' + nonce,
        '-t',
        image,
        directory,
    ])
    await docker([
        'volume',
        'create',
        '--label',
        'rentnerproxy-marketplace.test=' + nonce,
        volume,
    ])
    const first = prefix + '-first'
    await start(image, first)
    const core = await docker([
        'exec',
        first,
        'bun',
        '--no-env-file',
        '-e',
        'const response = await fetch("http://127.0.0.1:3004/core/health"); const core = await response.json(); if (!response.ok || core.status !== "running" || !Number.isInteger(core.pid) || typeof core.version !== "string") process.exit(1); const logs = await fetch("http://127.0.0.1:3004/logs?service=core"); const history = await logs.json(); if (!logs.ok || !history.entries.some((entry) => entry.event === "core.started")) process.exit(1)',
    ])
    assert(core.code === 0, 'Native Rust Core telemetry is unavailable.')
    await docker([
        'exec',
        first,
        'appliance-psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "CREATE TABLE appliance_fixture (value text); INSERT INTO appliance_fixture VALUES ('persistent-fixture')",
    ])
    await docker(['exec', first, 'valkey-cli', '--raw', 'ping']).then(
        (result) =>
            assert(
                result.stdout.includes('NOAUTH'),
                'Valkey accepted an unauthenticated client.',
            ),
    )
    const logs = await docker([
        'exec',
        first,
        'bun',
        '--no-env-file',
        '-e',
        'const result = await fetch("http://127.0.0.1:3004/logs?service=worker"); const text = await result.text(); if (!result.ok || !text.includes("fixture worker ready")) process.exit(1)',
    ])
    assert(logs.code === 0, 'Bundled process logs are unavailable.')
    await docker(['stop', '--time', '30', first])
    assert(
        (
            await docker(['inspect', '--format', '{{.State.ExitCode}}', first])
        ).stdout.trim() === '0',
        'Appliance did not drain cleanly.',
    )
    const second = prefix + '-second'
    await start(image, second)
    const persisted = await docker([
        'exec',
        second,
        'appliance-psql',
        '-Atqc',
        'SELECT value FROM appliance_fixture',
    ])
    assert(
        persisted.stdout.trim() === 'persistent-fixture',
        'PostgreSQL data did not survive container replacement.',
    )
    const events = await docker([
        'exec',
        second,
        'cat',
        '/data/storage/fixture-events.ndjson',
    ])
    assert(
        events.stdout.includes('worker:drained') &&
            events.stdout.includes('webserver:drained'),
        'Consumers lost their dependencies during shutdown.',
    )
    await docker([
        'exec',
        second,
        'touch',
        '/data/storage/fixture-worker-crash',
    ])
    assert(
        (await docker(['wait', second])).stdout.trim() === '1',
        'Required child failure did not stop the appliance.',
    )
    const maintenance = prefix + '-maintenance'
    await start(image, maintenance, ['maintenance'])
    await docker([
        'exec',
        maintenance,
        'bun',
        '--no-env-file',
        '-e',
        'for (const service of ["webserver", "worker", "valkey"]) { const result = await fetch("http://127.0.0.1:3004/logs?service=" + service); const logs = await result.json(); if (!result.ok || logs.entries.length !== 0) process.exit(1) }',
    ])
    assert(
        (
            await docker([
                'exec',
                maintenance,
                'appliance-psql',
                '-Atqc',
                'SELECT value FROM appliance_fixture',
            ])
        ).stdout.trim() === 'persistent-fixture',
        'Maintenance cannot access existing data.',
    )
    await docker(['stop', '--time', '30', maintenance])
    console.log(
        'Appliance verified: authenticated private dependencies, startup, logs, graceful drain, container replacement, persistence, required-child failure and PostgreSQL-only maintenance. No Drizzle or application migrations executed.',
    )
} finally {
    for (const name of containers) {
        const owner = await docker(
            [
                'inspect',
                '--format',
                '{{ index .Config.Labels "rentnerproxy-marketplace.test" }}',
                name,
            ],
            true,
        )
        if (owner.code === 0) {
            assert(
                owner.stdout.trim() === nonce,
                'Refusing cleanup of an unowned container.',
            )
            await docker(['rm', '-f', name])
        }
    }
    const owner = await docker(
        [
            'volume',
            'inspect',
            '--format',
            '{{ index .Labels "rentnerproxy-marketplace.test" }}',
            volume,
        ],
        true,
    )
    if (owner.code === 0) {
        assert(
            owner.stdout.trim() === nonce,
            'Refusing cleanup of an unowned volume.',
        )
        await docker(['volume', 'rm', volume])
    }
    for (const image of images) {
        const imageOwner = await docker(
            [
                'image',
                'inspect',
                '--format',
                '{{ index .Config.Labels "rentnerproxy-marketplace.test" }}',
                image,
            ],
            true,
        )
        if (imageOwner.code === 0 && imageOwner.stdout.trim() === nonce)
            await docker(['image', 'rm', image])
    }
    await runtimeImage?.cleanup()
    const path = relative(resolve(tmpdir()), resolve(directory))
    assert(
        path &&
            !isAbsolute(path) &&
            path !== '..' &&
            !path.startsWith('..' + sep),
        'Unsafe fixture directory cleanup.',
    )
    await rm(directory, { recursive: true, force: false })
}
