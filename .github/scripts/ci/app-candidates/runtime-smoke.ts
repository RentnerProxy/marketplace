import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    checkManifestCompatibility,
    contractVersion,
    parseProtocolDocument,
    type AppManifest,
} from '../../../../contracts/v1/index.ts'
import {
    appUser,
    attach,
    bindReadOnly,
    bunVersion,
    docker,
    withSandbox,
} from './sandbox-docker.ts'

const fixtureUser = '21002:21004'

export async function smokeInSandbox(options: {
    packageDirectory: string
    manifest: AppManifest
}) {
    const manifest = checkManifestCompatibility(options.manifest, {
        target: options.manifest.target,
        runtimeProfile: 'rentnerproxy-linux-v1',
        appProtocol: contractVersion,
        platformApi: contractVersion,
        uiBridge: contractVersion,
        engineCapabilities: ['caddy.load-balancing.v1', 'caddy.crowdsec.v1'],
    })
    const bootstrap = JSON.stringify(
        parseProtocolDocument('BootstrapDescriptor', {
            formatVersion: 1,
            appId: manifest.id,
            installationId: 'candidate-smoke',
            generation: 1,
            runtimeProfile: manifest.requires.runtimeProfile,
            versions: {
                appProtocol: contractVersion,
                platformApi: contractVersion,
                ...(manifest.ui ? { uiBridge: contractVersion } : {}),
            },
            appSocket: '/run-fixture/app/app.sock',
            coreSocket: '/run-fixture/core/core.sock',
            appCredential: randomBytes(32).toString('hex'),
            coreCredential: randomBytes(32).toString('hex'),
        }),
    )

    const work = await mkdtemp(join(tmpdir(), 'marketplace-candidate-smoke-'))
    try {
        const probe = await Bun.build({
            entrypoints: [join(import.meta.dir, 'runtime-smoke-probe.ts')],
            target: 'bun',
            outdir: work,
        })
        if (!probe.success)
            throw new Error('Failed to prepare the trusted v1 runtime probe')
        const path = join(work, 'runtime-smoke-probe.js')
        await chmod(path, 0o444)
        await withSandbox(
            {
                target: manifest.target,
                user: fixtureUser,
                memoryMiB: Math.min(2048, manifest.resources.memoryMiB + 192),
                processLimit: manifest.resources.processLimit + 24,
                mounts: [
                    ...bindReadOnly(options.packageDirectory, '/package'),
                    ...bindReadOnly(path, '/candidate-smoke.js'),
                    '--tmpfs',
                    '/run-fixture:rw,nosuid,nodev,noexec,size=8m,mode=1777',
                    '--tmpfs',
                    '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
                ],
                command: [
                    '/bin/sh',
                    '-ceu',
                    `test "$(bun --version)" = '${bunVersion}'; exec sleep infinity`,
                ],
            },
            async (name) => {
                await docker(['start', name])
                const timeout = manifest.resources.startupTimeoutMs + 10_000
                const manager = attach(
                    [
                        'exec',
                        '--interactive',
                        '--user',
                        fixtureUser,
                        name,
                        '/usr/bin/env',
                        '-i',
                        'PATH=/usr/local/bin:/usr/bin:/bin',
                        'HOME=/tmp',
                        '/usr/local/bin/bun',
                        '--no-env-file',
                        '/candidate-smoke.js',
                    ],
                    {
                        operation: 'Native v1 runtime probe',
                        input: bootstrap,
                        timeout,
                    },
                )
                const app = attach(
                    [
                        'exec',
                        '--interactive',
                        '--user',
                        appUser,
                        '--workdir',
                        '/package',
                        name,
                        '/usr/bin/env',
                        '-i',
                        'PATH=/usr/local/bin:/usr/bin:/bin',
                        'HOME=/tmp',
                        '/bin/sh',
                        '-ceu',
                        'mkdir -m 0770 /run-fixture/app; exec 3<&0 </dev/null; exec /package/bin/app',
                    ],
                    {
                        operation: 'Candidate app process',
                        input: bootstrap,
                        timeout,
                    },
                ).then(() => {
                    throw new Error(
                        'Candidate app exited during readiness smoke',
                    )
                })
                await Promise.race([manager, app])
            },
        )
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}
