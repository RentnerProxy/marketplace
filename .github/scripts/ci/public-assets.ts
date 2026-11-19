/* eslint-disable no-await-in-loop -- Poll bounded startup and clean up owned resources in lifecycle order. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runTooling } from '../native-tools.ts'

const image = process.env.RUNTIME_IMAGE_ID
if (
    !image ||
    !(await runTooling<boolean>('verification-runtime-image-ref', {
        reference: image,
    }))
)
    throw new Error('An existing isolated runtime image is required')
const owner = randomUUID()
const name = 'marketplace-public-assets-' + owner
const volume = name + '-data'
const label = 'rentnerproxy-marketplace.public-assets'

async function docker(args: string[], allowFailure = false) {
    const child = Bun.spawn(['docker', ...args], {
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
            'Isolated public-assets Docker check failed: ' +
                args[0] +
                '\n' +
                stderr,
        )
    return { code, stdout }
}

async function cleanup() {
    const containerOwner = await docker(
        ['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, name],
        true,
    )
    if (containerOwner.code === 0) {
        if (containerOwner.stdout.trim() !== owner)
            throw new Error(
                'Refusing to remove an unowned asset-test container',
            )
        await docker(['rm', '-f', name])
    }
    const volumeOwner = await docker(
        [
            'volume',
            'inspect',
            '--format',
            `{{ index .Labels "${label}" }}`,
            volume,
        ],
        true,
    )
    if (volumeOwner.code === 0) {
        if (volumeOwner.stdout.trim() !== owner)
            throw new Error('Refusing to remove an unowned asset-test volume')
        await docker(['volume', 'rm', volume])
    }
}

try {
    await docker(['volume', 'create', '--label', label + '=' + owner, volume])
    await docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        label + '=' + owner,
        '--network',
        'none',
        '--mount',
        `type=volume,source=${volume},target=/data`,
        ...Object.entries({
            POSTGRES_PASSWORD: 'isolated-public-assets-' + owner,
            POSTGRES_USER: 'postgres',
            ORIGIN: 'https://example.test',
            AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            SMTP_HOST: 'smtp.example.test',
            SMTP_PORT: '587',
            SMTP_SECURE: 'false',
            SMTP_USER: 'mail@example.test',
            SMTP_PASSWORD: 'isolated-mail',
            MAIL_FROM: 'mail@example.test',
        }).flatMap(([key, value]) => ['--env', key + '=' + value]),
        image,
    ])
    let ready = false
    for (let attempt = 0; attempt < 180; attempt += 1) {
        const state = await docker([
            'inspect',
            '--format',
            '{{.State.Running}} {{.State.Health.Status}}',
            name,
        ])
        if (state.stdout.trim() === 'true healthy') {
            ready = true
            break
        }
        if (!state.stdout.startsWith('true'))
            throw new Error(
                'Isolated public-assets appliance stopped during startup',
            )
        await Bun.sleep(500)
    }
    if (!ready)
        throw new Error('Isolated public-assets appliance readiness timed out')
    const fixture = await runTooling<string>('verification-fixture-text', {
        path: fileURLToPath(
            new URL('./public-assets.fixture.ts', import.meta.url),
        ),
    })
    const result = await docker([
        'exec',
        name,
        'bun',
        '--no-env-file',
        '-e',
        fixture,
    ])
    const checked = await runTooling<number>('verification-public-assets', {
        output: result.stdout,
    })
    console.log(
        `Verified ${checked} packaged public assets, image/font MIME types, GET/HEAD bytes and English public pages.`,
    )
} finally {
    await cleanup()
}
